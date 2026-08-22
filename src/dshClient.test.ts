import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

// The browser half (dsh/client.js) is a hand-written script in the
// __ModuleLoader__ bundle protocol: no module exports, browser globals only.
// It is evaluated here with those globals handed in as parameters, which pins
// the contracts no host-route test can see: the card never mounts where its
// route is off, the key field is never a plain visible input, and the copy
// follows dsh's own interface language.
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'dsh', 'client.js'), 'utf-8');

interface CardDraft extends Record<string, unknown> {
  engine: string;
  apiKey: string;
  baseURL: string;
  model: string;
  enabled: Record<string, boolean>;
}

interface Card {
  nextDraft: (summary: unknown, engine: string) => CardDraft;
  selectEngine: (summary: unknown, draft: CardDraft, engine: string) => CardDraft;
  toggleEngine: (draft: CardDraft, engine: string, enabled: boolean) => CardDraft;
  savePayload: (summary: unknown, draft: unknown) => Record<string, unknown>;
  secretFieldProps: () => Record<string, unknown>;
  ConfigCard: (react: unknown, ui: unknown, localeRef?: unknown) => () => unknown;
}

interface Definition {
  factory: (require: (id: string) => unknown) => {
    apply: (ctx: unknown) => void;
    __card: Card;
  };
}

/** Evaluate client.js with stubbed browser globals and hand back its exports. */
function evaluate(globals: {
  lang?: string;
  css?: unknown;
  fetch?: (url: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;
  getComputedStyle?: (elt: unknown) => { color?: string };
  matchMedia?: (query: string) => { matches: boolean };
}): Definition {
  let loaded: Definition | undefined;
  const windowStub = {
    __ModuleLoader__: {
      load: (definition: Definition) => {
        loaded = definition;
      },
    },
  };
  const documentStub = {
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelectorAll: () => [],
    documentElement: { lang: globals.lang ?? 'en' },
  };
  const fetchStub =
    globals.fetch ?? (() => Promise.resolve({ ok: true, status: 200, json: () => ({}) }));
  // Extra parameters shadow Node globals as undefined unless a test injects
  // them, so the card's theme probe is a no-op in every existing path.
  new Function(
    'window',
    'document',
    'CSS',
    'fetch',
    'navigator',
    'getComputedStyle',
    'matchMedia',
    SOURCE,
  )(
    windowStub,
    documentStub,
    globals.css,
    fetchStub,
    { language: globals.lang ?? 'en' },
    globals.getComputedStyle,
    globals.matchMedia,
  );
  if (!loaded) {
    throw new Error('client.js never called __ModuleLoader__.load');
  }
  return loaded;
}

/** A drained microtask queue: the card's fetch chains are promise-only. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

const SUMMARY = {
  engine: 'tavily',
  engines: {
    'antigravity-cli': {
      baseURL: '',
      model: 'gemini-3-pro',
      hasKey: false,
      keySource: null,
      enabled: true,
    },
    tavily: {
      baseURL: 'https://a.example',
      model: '',
      hasKey: true,
      keySource: 'file',
      enabled: true,
    },
    exa: { baseURL: '', model: '', hasKey: false, keySource: null, enabled: false },
    firecrawl: { baseURL: '', model: '', hasKey: false, keySource: null, enabled: true },
    'grok-cli': { baseURL: '', model: '', hasKey: false, keySource: null, enabled: true },
    local: { baseURL: '', model: '', hasKey: false, keySource: null, enabled: true },
  },
  keyed: ['tavily', 'exa', 'firecrawl'],
  models: ['antigravity-cli'],
};

describe('the settings card mounts only where its route answers', () => {
  function loadCard(configStatus: number) {
    const slotSpecs: Array<Record<string, unknown>> = [];
    const injected: string[][] = [];
    const definition = evaluate({
      fetch: (url: string) =>
        Promise.resolve({
          ok: configStatus >= 200 && configStatus < 300,
          status: url.startsWith('/modsearch/config') ? configStatus : 200,
          json: () => Promise.resolve({}),
        }),
    });
    const exports = definition.factory(() => ({
      createElement: () => null,
      useState: (initial: unknown) => [initial, () => {}],
      useEffect: () => {},
      useCallback: (fn: unknown) => fn,
    }));
    exports.apply({
      effect: () => {},
      inject: (deps: string[], fn: (scope: unknown) => void) => {
        injected.push(deps);
        if (deps.includes('slots')) {
          fn({
            slots: {
              inject: (_name: string, gen: () => Generator) => {
                for (const _entry of gen()) {
                  // consuming the generator performs the registration
                }
              },
              register: (spec: Record<string, unknown>) => {
                slotSpecs.push(spec);
                return spec;
              },
            },
          });
        }
      },
    });
    return { slotSpecs, injected, card: exports.__card };
  }

  it('does not mount where the route is off, instead of rendering an error', async () => {
    // settingsCard: false removes the host route. A card that mounted anyway
    // would show a failure where the user asked for nothing.
    const off = loadCard(404);
    await settle();
    expect(off.slotSpecs).toEqual([]);
  });

  it('registers under the key rc.7 dispatches by and the id rc.6 lists by', async () => {
    // rc.7 made settings.plugin.item a keyed slot: a card renders only when
    // its key matches a settings namespace the host serves, and the host half
    // serves 'modsearch'. rc.6's list slot needed options.id instead, and one
    // client.js serves both, so both ride along.
    const on = loadCard(200);
    await settle();
    const spec = on.slotSpecs.find((entry) => entry.name === 'settings.plugin.item');
    expect(spec?.key).toBe('modsearch');
    expect(spec?.id).toBe('modsearch');
  });

  it('asks for the locale service on its own inject, not beside slots', async () => {
    // ctx.inject waits for every service it names. Naming locale beside slots
    // would mean no card at all on a host that ships no locale service, which
    // is the opposite of an optional dependency.
    const on = loadCard(200);
    await settle();
    expect(on.injected).toContainEqual(['locale']);
    expect(on.injected).toContainEqual(['slots']);
    expect(on.slotSpecs).toHaveLength(1);
  });
});

describe('a save carries only what the save is about', () => {
  const card = () => evaluate({}).factory(() => ({})).__card;

  it('sends the pin only when the select moved, and the fields only when edited', () => {
    const { nextDraft, savePayload } = card();
    const untouched = nextDraft(SUMMARY, 'tavily');
    expect(savePayload(SUMMARY, untouched)).toEqual({});

    const edited = savePayload(SUMMARY, { ...untouched, apiKey: 'tvly-new' });
    expect(edited.target).toBe('tavily');
    expect(edited.apiKey).toBe('tvly-new');
    expect(edited.engine).toBeUndefined();

    const repinned = savePayload(SUMMARY, nextDraft(SUMMARY, ''));
    expect(repinned.engine).toBe('');
    expect(repinned.target).toBeUndefined();
  });

  it('never sends a key or an endpoint for an engine that has nowhere to put one', () => {
    // The host refuses those, and a card that sent them would turn a harmless
    // engine switch into a failed save.
    const { nextDraft, savePayload } = card();
    const draft = { ...nextDraft(SUMMARY, 'grok-cli'), apiKey: 'xai-leftover' };
    const payload = savePayload(SUMMARY, draft);
    expect(payload.apiKey).toBeUndefined();
    expect(payload.baseURL).toBeUndefined();
    expect(payload.engine).toBe('grok-cli');
  });

  it('sends a model only for the engine that reads one', () => {
    const { nextDraft, savePayload } = card();
    const agy = savePayload(SUMMARY, {
      ...nextDraft(SUMMARY, 'antigravity-cli'),
      model: 'gemini-3-flash',
    });
    expect(agy.target).toBe('antigravity-cli');
    expect(agy.model).toBe('gemini-3-flash');
    expect(agy.apiKey).toBeUndefined();

    const exa = savePayload(SUMMARY, { ...nextDraft(SUMMARY, 'exa'), apiKey: 'exa-1' });
    expect(exa.model).toBeUndefined();
    expect(exa.apiKey).toBe('exa-1');
  });

  it('seeds the draft from the engine it switched to, never the one before it', () => {
    const { nextDraft } = card();
    const next = nextDraft(SUMMARY, 'antigravity-cli');
    expect(next).toEqual({
      engine: 'antigravity-cli',
      apiKey: '',
      baseURL: '',
      model: 'gemini-3-pro',
      enabled: {
        'antigravity-cli': true,
        tavily: true,
        exa: false,
        firecrawl: true,
        'grok-cli': true,
        local: true,
      },
    });
  });

  it('sends only engine checkboxes that changed', () => {
    const { nextDraft, savePayload } = card();
    const draft = nextDraft(SUMMARY, 'tavily');
    draft.enabled.tavily = false;
    draft.enabled.exa = true;
    expect(savePayload(SUMMARY, draft).enabled).toEqual({ tavily: false, exa: true });
  });

  it('leaves the file alone when a preference is switched away and back', () => {
    // The chain shows no row for `local`, so nothing on screen says it is
    // switched off. Selecting it back as the preference used to tick it
    // silently, and the save then deleted an override the user never saw.
    const { nextDraft, selectEngine, savePayload } = card();
    const summary = {
      ...SUMMARY,
      engine: 'local',
      engines: { ...SUMMARY.engines, local: { ...SUMMARY.engines.local, enabled: false } },
    };
    let draft = nextDraft(summary, 'local');
    draft = selectEngine(summary, draft, 'tavily');
    draft = selectEngine(summary, draft, 'local');
    expect(savePayload(summary, draft)).toEqual({});
  });

  it('pins an engine the chain cannot show without switching it on behind the user', () => {
    // exa is not ready here, so it has no checkbox. Pinning it is a decision
    // about preference, not about the override the user cannot see.
    const { nextDraft, selectEngine, savePayload } = card();
    const summary = {
      ...SUMMARY,
      engines: { ...SUMMARY.engines, exa: { ...SUMMARY.engines.exa, enabled: false } },
      readiness: READINESS,
    };
    const draft = selectEngine(summary, nextDraft(summary, 'tavily'), 'exa');
    expect(savePayload(summary, draft)).toEqual({ engine: 'exa' });
  });

  it('keeps pending checkboxes coherent when the preferred engine changes', () => {
    const { nextDraft, selectEngine, toggleEngine } = card();
    let draft = nextDraft(SUMMARY, 'tavily');
    draft = toggleEngine(draft, 'exa', true);
    draft = selectEngine(SUMMARY, draft, 'antigravity-cli');
    expect(draft.enabled.exa).toBe(true);
    expect(draft.enabled['antigravity-cli']).toBe(true);

    draft = toggleEngine(draft, 'antigravity-cli', false);
    expect(draft.engine).toBe('');

    draft = selectEngine(SUMMARY, draft, 'exa');
    expect(draft.engine).toBe('exa');
    expect(draft.enabled.exa).toBe(true);
  });
});

describe('the API key field is masked without being a password field', () => {
  // Safari's iCloud Keychain offers to enable autofill for any site with a
  // password input, then pops its bubble on every focus, for a field that is
  // always empty here: the key lives in the config file and the host sends
  // only whether one is stored.
  function secretProps(css: unknown): Record<string, unknown> {
    return evaluate({ css })
      .factory(() => ({}))
      .__card.secretFieldProps();
  }

  it('explains comma-separated key rotation in both interface languages', () => {
    expect(
      render(SUMMARY).texts.some((text) => /separate multiple keys with commas/i.test(text)),
    ).toBe(true);
    expect(
      render(SUMMARY, 'zh-CN').texts.some((text) => text.includes('多个密钥用英文逗号分隔')),
    ).toBe(true);
  });

  it('masks with text-security where the browser supports it', () => {
    const props = secretProps({ supports: (name: string) => name === '-webkit-text-security' });
    expect(props.type).toBe('text');
    expect((props.style as Record<string, unknown>).WebkitTextSecurity).toBe('disc');
    expect(props.autoComplete).toBe('off');
  });

  it('falls back to a password field rather than showing the key', () => {
    expect(secretProps({ supports: () => false }).type).toBe('password');
    expect(secretProps(undefined).type).toBe('password');
  });

  it('never renders the key field as a plain visible input', () => {
    // Pinning the field the card actually builds, not just the helper: a call
    // site asking for a plain text field would leave every helper test green
    // while the key rendered in clear text.
    for (const css of [{ supports: () => true }, { supports: () => false }, undefined]) {
      const built: Array<{ type: unknown; props: Record<string, unknown> }> = [];
      const draft = { engine: 'tavily', apiKey: '', baseURL: '', model: '' };
      const states = [true, SUMMARY, draft, ''];
      let index = 0;
      const react = {
        createElement: (type: unknown, props: Record<string, unknown>, ...kids: unknown[]) => {
          built.push({ type, props: props ?? {} });
          return { type, props, kids };
        },
        useState: () => [states[index++ % states.length], () => {}],
        useEffect: () => {},
        useCallback: (fn: unknown) => fn,
      };
      const Input = function Input() {
        return null;
      };
      evaluate({ css })
        .factory(() => ({}))
        .__card.ConfigCard(react, { Input })();
      const field = built
        .filter((node) => node.type === Input)
        .find((node) => String(node.props.placeholder ?? '').match(/留空|leave empty/));
      expect(field).toBeDefined();
      const masked =
        field?.props.type === 'password' ||
        (field?.props.style as Record<string, unknown> | undefined)?.WebkitTextSecurity === 'disc';
      expect(masked).toBe(true);
    }
  });
});

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  kids: unknown[];
}

/** One row of the engine chain: what it reads as, and what it is set to. */
interface ChainRow {
  label: string;
  checked: unknown;
  title: unknown;
}

interface Rendered {
  card: Card;
  draft: CardDraft;
  nodes: Node[];
  chain: ChainRow[];
  options: Array<{ value: unknown; label: string }>;
  texts: string[];
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'kids' in value;
}

/** Every string under a node, in reading order: what the row says out loud. */
function textOf(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(textOf).join(' ');
  }
  return isNode(value) ? textOf(value.kids) : '';
}

/** One expanded card, rendered in English, with the parts tests ask about. */
function render(
  summary: Record<string, unknown>,
  lang = 'en',
  probes?: {
    getComputedStyle?: (elt: unknown) => { color?: string };
    matchMedia?: (query: string) => { matches: boolean };
  },
): Rendered {
  const card = evaluate({ lang, ...probes }).factory(() => ({})).__card;
  const draft = card.nextDraft(summary, String(summary.engine ?? ''));
  const states = [true, summary, draft, ''];
  const built: Node[] = [];
  let index = 0;
  const react = {
    createElement: (type: unknown, props: Record<string, unknown>, ...kids: unknown[]) => {
      const node = { type, props: props ?? {}, kids };
      built.push(node);
      return node;
    },
    useState: () => [states[index++ % states.length], () => {}],
    useEffect: () => {},
    useCallback: (fn: unknown) => fn,
  };
  const Input = function Input() {
    return null;
  };
  card.ConfigCard(react, { Input })();
  const boxOf = (node: Node): Node | undefined =>
    node.kids.find((kid) => isNode(kid) && kid.props.type === 'checkbox') as Node | undefined;
  return {
    card,
    draft,
    nodes: built,
    chain: built
      .filter((node) => node.type === 'label' && boxOf(node) !== undefined)
      .map((node) => ({
        label: textOf(node.kids).replace(/\s+/g, ' ').trim(),
        checked: boxOf(node)?.props.checked,
        title: node.props.title,
      })),
    options: built
      .filter((node) => node.type === 'option')
      .map((node) => ({
        value: node.props.value,
        label: node.kids.filter((kid) => typeof kid === 'string').join(''),
      })),
    texts: built
      .flatMap((node) => node.kids)
      .filter((kid): kid is string => typeof kid === 'string'),
  };
}

const READINESS = [
  { engine: 'antigravity-cli', ready: false, reason: 'binary "agy" not found', keySource: null },
  { engine: 'tavily', ready: true, reason: 'API key present', keySource: 'file' },
  { engine: 'exa', ready: false, reason: 'no API key', keySource: null },
  { engine: 'firecrawl', ready: true, reason: 'keyless', keySource: null },
  { engine: 'grok-cli', ready: false, reason: 'binary "grok" not found', keySource: null },
  { engine: 'local', ready: true, reason: 'built in', keySource: null },
];

describe('the automatic engine chain lists what this machine can actually search with', () => {
  // The chain is a set of checkboxes, one per search engine the machine is
  // ready to run. An engine doctor cannot run here is not a row the user can
  // act on, so it is left out entirely rather than shown greyed with a reason
  // beside it, and so is `local`, which fetches pages and never searches.

  it('drops the engines doctor cannot run here, and says nothing about status', () => {
    const view = render({ ...SUMMARY, readiness: READINESS });
    expect(view.chain.map((row) => row.label)).toEqual(['tavily', 'firecrawl']);
    // Scanned as substrings, not compared whole: a row reading "tavily ready"
    // passes an exact-match check for "ready" and still shows the word.
    expect(view.chain.map((row) => row.label).join(' ')).not.toMatch(
      /ready|not installed|API key|keyless/i,
    );
  });

  it('never carries a doctor reason back in as a tooltip', () => {
    // The reasons are English strings from the CLI, and the row said its piece
    // by existing. A title attribute would put untranslated status text back on
    // a card that just took it off.
    const view = render({ ...SUMMARY, readiness: READINESS });
    expect(view.chain.map((row) => row.title)).toEqual([undefined, undefined]);
    expect(view.nodes.some((node) => node.props.title !== undefined)).toBe(false);
  });

  it('leaves the page fetcher out of a row of search engines', () => {
    // `local` reads a URL it is handed. It is in no search chain, so a tickbox
    // among the search engines would only invite a decision that does nothing.
    const view = render({ ...SUMMARY, readiness: READINESS });
    expect(view.chain.map((row) => row.label).join(' ')).not.toContain('local');
  });

  it('marks grok-cli as the one that only searches X, where a reader hears it', () => {
    // grok-cli serves the social role alone: it never joins web-search
    // failover, and an unmarked tickbox in this row would promise it does. The
    // note rides inside the label that names the checkbox, so it is announced
    // rather than painted: an aria-label of just the engine name would hide it.
    const view = render({
      ...SUMMARY,
      readiness: READINESS.map((entry) =>
        entry.engine === 'grok-cli' ? { ...entry, ready: true } : entry,
      ),
    });
    expect(view.chain.map((row) => row.label)).toContain('grok-cli X search only');
    const box = view.nodes.find(
      (node) => node.props.type === 'checkbox' && typeof node.props['aria-label'] === 'string',
    );
    expect(box?.props['aria-label'] ?? 'grok-cli X search only').toContain('X search only');
  });

  it('keeps a ready engine on screen after it was switched off', () => {
    // Hiding an unchecked engine would be a one-way door: the checkbox is the
    // only way back on, and dsh web users have no terminal to undo it with.
    const view = render({
      ...SUMMARY,
      engines: { ...SUMMARY.engines, firecrawl: { ...SUMMARY.engines.firecrawl, enabled: false } },
      readiness: READINESS,
    });
    expect(view.chain.find((row) => row.label === 'firecrawl')?.checked).toBe(false);
  });

  it('never writes over a hidden engine’s stored override when the card saves', () => {
    // exa is not ready here and `local` is never in this row at all, so neither
    // has a checkbox. Gone from the screen must not mean gone from the file:
    // their `enabled: false` is not this save's business, and a payload naming
    // them would delete the override.
    const summary = {
      ...SUMMARY,
      engines: { ...SUMMARY.engines, local: { ...SUMMARY.engines.local, enabled: false } },
      readiness: READINESS,
    };
    const view = render(summary);
    const draft = view.card.toggleEngine(view.draft, 'firecrawl', false);
    const payload = view.card.savePayload(summary, draft);
    expect(payload.enabled).toEqual({ firecrawl: false });
  });

  it('says the machine has nothing ready rather than showing an empty chain', () => {
    const view = render({ ...SUMMARY, readiness: [] });
    expect(view.chain).toHaveLength(0);
    expect(view.texts.some((text) => /No engine is ready/i.test(text))).toBe(true);
  });

  it('lists every search engine when doctor’s answer never arrived', () => {
    // A failed probe is not a verdict of "nothing works here". Hiding the whole
    // chain then would take away controls over a fact the card does not know.
    const view = render(SUMMARY);
    expect(view.chain.map((row) => row.label)).toEqual([
      'antigravity-cli',
      'tavily',
      'exa',
      'firecrawl',
      'grok-cli X search only',
    ]);
    expect(view.texts.some((text) => /status is unavailable/i.test(text))).toBe(true);
  });

  it('speaks its own asides in Chinese under a Chinese card', () => {
    // Four lines that only ever appear in this section. An English string
    // leaking into a Chinese card is invisible to every test that renders in
    // English, which is every other test here.
    const zh = (summary: Record<string, unknown>): string[] => render(summary, 'zh-CN').texts;
    expect(zh({ ...SUMMARY, readiness: READINESS.map((e) => ({ ...e, ready: true })) })).toContain(
      '仅 X 搜索',
    );
    expect(zh({ ...SUMMARY, readiness: [] })).toContain('本机暂无就绪的引擎。');
    expect(zh(SUMMARY)).toContain('暂时读不到引擎状态，所以列出全部引擎。');
    expect(zh({ ...SUMMARY, engine: 'firecrawl', readiness: READINESS })).toContain(
      '默认使用免注册的免费额度，填入密钥可提高配额。',
    );
  });

  it('says firecrawl needs no key, until one is stored', () => {
    // The default engine works with no signup at all. Silence there reads as a
    // key being required, which is the one thing this engine does not need.
    // Matched on the whole sentence: the same words label the select option,
    // which is there whether or not a key is stored.
    const note = /Runs on the keyless free tier/i;
    const keyless = render({ ...SUMMARY, engine: 'firecrawl', readiness: READINESS });
    expect(keyless.texts.some((text) => note.test(text))).toBe(true);

    const keyed = render({
      ...SUMMARY,
      engine: 'firecrawl',
      engines: { ...SUMMARY.engines, firecrawl: { ...SUMMARY.engines.firecrawl, hasKey: true } },
      readiness: READINESS,
    });
    expect(keyed.texts.some((text) => note.test(text))).toBe(false);
  });
});

describe('a save re-reads what the machine can do now', () => {
  it('asks doctor again after saving, so a key that just landed grows a checkbox', async () => {
    // Readiness was read once, when the card was expanded. Saving the very key
    // that makes an engine ready would otherwise leave its checkbox missing
    // until the whole card was closed and opened again.
    const urls: string[] = [];
    const fresh = [
      { engine: 'tavily', ready: true, reason: 'API key present', keySource: 'file' },
      { engine: 'exa', ready: true, reason: 'API key present', keySource: 'file' },
    ];
    const stale = [{ engine: 'tavily', ready: true, reason: 'API key present', keySource: 'file' }];
    const definition = evaluate({
      lang: 'en',
      fetch: (url: string, init?: { method?: string }) => {
        urls.push(url);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve(
              init?.method === 'POST' ? { ...SUMMARY } : { ...SUMMARY, readiness: fresh },
            ),
        });
      },
    });
    const card = definition.factory(() => ({})).__card;
    const summary = { ...SUMMARY, readiness: stale };
    const draft = { ...card.nextDraft(summary, 'exa'), apiKey: 'exa-new' };
    const summaries: Array<Record<string, unknown>> = [];
    const nodes: Node[] = [];
    let index = 0;
    const react = {
      createElement: (type: unknown, props: Record<string, unknown>, ...kids: unknown[]) => {
        const node = { type, props: props ?? {}, kids };
        nodes.push(node);
        return node;
      },
      useState: () => {
        const slot = index++;
        return [
          [true, summary, draft, ''][slot],
          (value: unknown) => {
            if (slot === 1) {
              summaries.push(value as Record<string, unknown>);
            }
          },
        ];
      },
      useEffect: () => {},
      useCallback: (fn: unknown) => fn,
    };
    const Input = function Input() {
      return null;
    };
    card.ConfigCard(react, { Input })();
    const save = nodes.find((node) => node.type === 'button' && node.kids.includes('Save'));
    if (!save) {
      throw new Error('no save button');
    }
    (save.props.onClick as () => void)();
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }

    expect(urls.filter((url) => url.includes('doctor'))).toHaveLength(1);
    expect(summaries[summaries.length - 1]?.readiness).toEqual(fresh);
  });

  it('keeps the saved note when the fresh readiness read fails', async () => {
    // The save landed. A follow-up probe that did not is no reason to tell the
    // user their save failed.
    const notes: string[] = [];
    const definition = evaluate({
      lang: 'en',
      fetch: (_url: string, init?: { method?: string }) =>
        init?.method === 'POST'
          ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...SUMMARY }) })
          : Promise.reject(new Error('offline')),
    });
    const card = definition.factory(() => ({})).__card;
    const draft = { ...card.nextDraft(SUMMARY, 'tavily'), apiKey: 'tvly-new' };
    const nodes: Node[] = [];
    let index = 0;
    const react = {
      createElement: (type: unknown, props: Record<string, unknown>, ...kids: unknown[]) => {
        const node = { type, props: props ?? {}, kids };
        nodes.push(node);
        return node;
      },
      useState: () => {
        const slot = index++;
        return [
          [true, SUMMARY, draft, ''][slot],
          (value: unknown) => {
            if (slot === 3) {
              notes.push(String(value));
            }
          },
        ];
      },
      useEffect: () => {},
      useCallback: (fn: unknown) => fn,
    };
    const Input = function Input() {
      return null;
    };
    card.ConfigCard(react, { Input })();
    const save = nodes.find((node) => node.type === 'button' && node.kids.includes('Save'));
    if (!save) {
      throw new Error('no save button');
    }
    (save.props.onClick as () => void)();
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
    expect(notes).toEqual(['saving...', 'saved']);
  });
});

describe('the preference list offers only engines a preference can mean', () => {
  const values = (view: Rendered): unknown[] => view.options.map((option) => option.value);

  it('leaves the page fetcher out of the list', () => {
    // Pinning `local` would pin the page fetcher as the search engine, which
    // searches nothing. The option was an invitation to break search.
    expect(values(render(SUMMARY))).toEqual([
      '',
      'antigravity-cli',
      'tavily',
      'exa',
      'firecrawl',
      'grok-cli',
    ]);
  });

  it('keeps the page fetcher listed while the config still pins it', () => {
    // A CLI-set `engine: local` is the state of the file. Dropping the option
    // would leave the select showing some other engine as the preference, which
    // is the card lying about what is configured.
    const view = render({ ...SUMMARY, engine: 'local' });
    expect(values(view)).toContain('local');
    expect(view.draft.engine).toBe('local');
  });

  it('marks firecrawl as the one that needs no signup', () => {
    const view = render(SUMMARY);
    expect(view.options.find((option) => option.value === 'firecrawl')?.label).toBe(
      'firecrawl (keyless free tier)',
    );
    expect(view.options.find((option) => option.value === 'tavily')?.label).toBe('tavily');
  });

  it('says it in Chinese under a Chinese card', () => {
    const view = render({ ...SUMMARY, engine: '' }, 'zh-CN');
    expect(view.options.find((option) => option.value === 'firecrawl')?.label).toBe(
      'firecrawl（免注册免费）',
    );
  });
});

describe('the preferred-engine menu stays readable in the host theme', () => {
  // Native popups ignore inherit color. On a dark card they would otherwise
  // paint as white-on-white, which is a list nobody can read.
  const LIGHT_OPTION = { color: '#23262a', background: '#f2f2f2' };
  const DARK_OPTION = { color: '#f2f2f2', background: '#23262a' };

  function menuOf(view: Rendered): { select: Node | undefined; options: Node[] } {
    return {
      select: view.nodes.find((node) => node.type === 'select'),
      options: view.nodes.filter((node) => node.type === 'option'),
    };
  }

  function schemeOf(select: Node | undefined): unknown {
    return (select?.props.style as Record<string, unknown> | undefined)?.colorScheme;
  }

  it('keeps the native light look when the card theme cannot be read', () => {
    expect(() => render(SUMMARY)).not.toThrow();
    const { select, options } = menuOf(render(SUMMARY));
    expect(schemeOf(select)).toBe('light');
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.props.style).toEqual(LIGHT_OPTION);
    }
  });

  it('paints a dark popup when the card text is light', () => {
    const { select, options } = menuOf(
      render(SUMMARY, 'en', {
        getComputedStyle: () => ({ color: 'rgb(242, 242, 242)' }),
      }),
    );
    expect(schemeOf(select)).toBe('dark');
    for (const option of options) {
      expect(option.props.style).toEqual(DARK_OPTION);
    }
  });

  it('keeps a light popup when the card text is dark, even if the OS prefers dark', () => {
    const { select, options } = menuOf(
      render(SUMMARY, 'en', {
        getComputedStyle: () => ({ color: 'rgb(35, 38, 42)' }),
        matchMedia: () => ({ matches: true }),
      }),
    );
    expect(schemeOf(select)).toBe('light');
    for (const option of options) {
      expect(option.props.style).toEqual(LIGHT_OPTION);
    }
  });

  it('follows an OS dark preference when the card color cannot be read', () => {
    const { select, options } = menuOf(
      render(SUMMARY, 'en', {
        matchMedia: (query) => ({ matches: query === '(prefers-color-scheme: dark)' }),
      }),
    );
    expect(schemeOf(select)).toBe('dark');
    for (const option of options) {
      expect(option.props.style).toEqual(DARK_OPTION);
    }
  });
});

describe('a failed load or save speaks the reader’s language', () => {
  // The footer note lands in a role="status" region, so it is read aloud.
  // A hard-coded English fallback would put "load failed" under a Chinese
  // card. What the server said still travels untranslated: that is the
  // diagnosis, not the card's copy.
  interface Node {
    type: unknown;
    props: Record<string, unknown>;
    kids: unknown[];
  }

  function render(options: { lang: string; states: unknown[]; detail?: string }): {
    notes: string[];
    nodes: Node[];
  } {
    const definition = evaluate({
      lang: options.lang,
      fetch: () =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve(options.detail ? { error: options.detail } : {}),
        }),
    });
    const notes: string[] = [];
    const nodes: Node[] = [];
    let index = 0;
    const react = {
      createElement: (type: unknown, props: Record<string, unknown>, ...kids: unknown[]) => {
        const node = { type, props: props ?? {}, kids };
        nodes.push(node);
        return node;
      },
      useState: () => {
        const slot = index++;
        return [
          options.states[slot],
          (value: unknown) => {
            // The note is the fourth useState, after open, summary and draft.
            if (slot === 3) {
              notes.push(String(value));
            }
          },
        ];
      },
      useEffect: (fn: () => void) => {
        fn();
      },
      useCallback: (fn: unknown) => fn,
    };
    const Input = function Input() {
      return null;
    };
    definition.factory(() => ({})).__card.ConfigCard(react, { Input })();
    return { notes, nodes };
  }

  /** Expanded with nothing loaded yet: the effect fires the load, which fails. */
  const loadStates = (): unknown[] => [true, null, null, ''];
  /** Expanded with a summary whose draft was edited, so save is enabled. */
  const saveStates = (): unknown[] => [
    true,
    SUMMARY,
    { engine: 'tavily', apiKey: 'tvly-new', baseURL: 'https://a.example', model: '' },
    '',
  ];

  function clickSave(nodes: Node[], label: string): void {
    const button = nodes.find((node) => node.type === 'button' && node.kids.includes(label));
    if (!button) {
      throw new Error(`no save button labelled ${label}`);
    }
    (button.props.onClick as () => void)();
  }

  it('falls back to a localized line when the server said nothing', async () => {
    const zh = render({ lang: 'zh-CN', states: loadStates() });
    await settle();
    expect(zh.notes).toEqual(['加载失败']);

    const en = render({ lang: 'en', states: loadStates() });
    await settle();
    expect(en.notes).toEqual(['load failed']);
  });

  it('says so in the reader’s language when a save fails', async () => {
    const zh = render({ lang: 'zh-CN', states: saveStates() });
    clickSave(zh.nodes, '保存');
    await settle();
    expect(zh.notes).toEqual(['保存中…', '保存失败']);

    const en = render({ lang: 'en', states: saveStates() });
    clickSave(en.nodes, 'Save');
    await settle();
    expect(en.notes).toEqual(['saving...', 'save failed']);
  });

  it('shows what the server said rather than translating it', async () => {
    // 'unknown engine: x' and path errors are the diagnosis. Mapping them to
    // error codes would buy a translation table for a dozen strings.
    const zh = render({ lang: 'zh-CN', states: loadStates(), detail: 'unknown engine: x' });
    await settle();
    expect(zh.notes).toEqual(['unknown engine: x']);
  });
});

describe('the card follows dsh’s own interface language', () => {
  // dsh ships `<html lang="zh-CN">` frozen into the built index.html and never
  // rewrites it, so a user whose dsh is set to English still got a Chinese
  // card. The locale service knows the real answer, so it is asked first and
  // the page language is only the fallback.
  class FakeLocale {
    private snapshot: { active: string; locales: unknown[]; revision: number };
    private readonly listeners = new Set<() => void>();
    public subscribeCalls = 0;

    constructor(active: string) {
      this.snapshot = { active, locales: [], revision: 1 };
    }

    getSnapshot(): { active: string; locales: unknown[]; revision: number } {
      return this.snapshot;
    }

    subscribe(fn: () => void): () => void {
      this.subscribeCalls += 1;
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    setLocale(active: string): void {
      this.snapshot = { active, locales: [], revision: this.snapshot.revision + 1 };
      for (const fn of this.listeners) {
        fn();
      }
    }
  }

  interface Mounted {
    texts: string[];
    renders: number;
  }

  function mount(options: { lang: string; locale?: FakeLocale }): Mounted {
    const definition = evaluate({ lang: options.lang });
    const state: Mounted = { texts: [], renders: 0 };
    let subscribed = false;
    const react = {
      createElement: (type: unknown, props: Record<string, unknown>, ...kids: unknown[]) => {
        for (const kid of kids) {
          if (typeof kid === 'string') {
            state.texts.push(kid);
          }
        }
        return { type, props: props ?? {}, kids };
      },
      useState: (initial: unknown) => [initial, () => {}],
      useEffect: () => {},
      useCallback: (fn: unknown) => fn,
      useSyncExternalStore: (
        subscribe: (onChange: () => void) => () => void,
        getSnapshot: () => unknown,
      ) => {
        // React subscribes once per mount and re-renders on notice.
        if (!subscribed) {
          subscribed = true;
          subscribe(() => {
            state.renders += 1;
            state.texts = [];
            Card();
          });
        }
        return getSnapshot();
      },
    };
    const Input = function Input() {
      return null;
    };
    const Card = definition
      .factory(() => ({}))
      .__card.ConfigCard(
        react,
        { Input },
        options.locale ? { current: options.locale } : undefined,
      );
    Card();
    return state;
  }

  // Not "网页搜索": dsh ships its own "网页搜索（DeepSeek 搜索提供方）" card in
  // the same list, and two cards whose names start alike is a list nobody can
  // read. This name pairs with the sibling plugin's 视觉引擎（ModLens）.
  const ZH_TITLE = '搜索引擎（ModSearch）';
  const EN_TITLE = 'Search engine (ModSearch)';

  it('speaks English where dsh is set to English under a zh-CN page', () => {
    const card = mount({ lang: 'zh-CN', locale: new FakeLocale('en') });
    expect(card.texts).toContain(EN_TITLE);
    expect(card.texts).not.toContain(ZH_TITLE);
  });

  it('speaks Chinese where dsh is set to Chinese under an English page', () => {
    const card = mount({ lang: 'en-US', locale: new FakeLocale('zh') });
    expect(card.texts).toContain(ZH_TITLE);
    expect(card.texts).not.toContain(EN_TITLE);
  });

  it('falls back to the page language where the host serves no locale service', () => {
    expect(mount({ lang: 'zh-CN' }).texts).toContain(ZH_TITLE);
    expect(mount({ lang: 'en-US' }).texts).toContain(EN_TITLE);
  });

  it('switches copy when the user switches language mid-session', () => {
    const locale = new FakeLocale('zh');
    const card = mount({ lang: 'zh-CN', locale });
    expect(card.texts).toContain(ZH_TITLE);
    expect(locale.subscribeCalls).toBe(1);

    locale.setLocale('en');
    expect(card.renders).toBe(1);
    expect(card.texts).toContain(EN_TITLE);
    expect(card.texts).not.toContain(ZH_TITLE);
  });
});
