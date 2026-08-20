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

interface Definition {
  factory: (require: (id: string) => unknown) => {
    apply: (ctx: unknown) => void;
    __card: {
      nextDraft: (summary: unknown, engine: string) => CardDraft;
      selectEngine: (summary: unknown, draft: CardDraft, engine: string) => CardDraft;
      toggleEngine: (draft: CardDraft, engine: string, enabled: boolean) => CardDraft;
      savePayload: (summary: unknown, draft: unknown) => Record<string, unknown>;
      secretFieldProps: () => Record<string, unknown>;
      ConfigCard: (react: unknown, ui: unknown, localeRef?: unknown) => () => unknown;
    };
  };
}

/** Evaluate client.js with stubbed browser globals and hand back its exports. */
function evaluate(globals: {
  lang?: string;
  css?: unknown;
  fetch?: (url: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;
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
  new Function('window', 'document', 'CSS', 'fetch', 'navigator', SOURCE)(
    windowStub,
    documentStub,
    globals.css,
    fetchStub,
    { language: globals.lang ?? 'en' },
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

describe('the automatic engine chain is editable', () => {
  it('renders one checkbox per engine while keeping doctor readiness as status text', () => {
    const definition = evaluate({ lang: 'en' });
    const card = definition.factory(() => ({})).__card;
    const summary = {
      ...SUMMARY,
      readiness: [
        { engine: 'tavily', ready: true, reason: 'API key present', keySource: 'file' },
        { engine: 'exa', ready: false, reason: 'no API key', keySource: null },
      ],
    };
    const draft = card.nextDraft(summary, summary.engine);
    const states = [true, summary, draft, ''];
    const built: Array<{ type: unknown; props: Record<string, unknown>; kids: unknown[] }> = [];
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

    const checkboxes = built.filter(
      (node) => node.type === 'input' && node.props.type === 'checkbox',
    );
    expect(checkboxes).toHaveLength(6);
    expect(checkboxes.find((node) => node.props['aria-label'] === 'tavily')?.props.checked).toBe(
      true,
    );
    expect(checkboxes.find((node) => node.props['aria-label'] === 'exa')?.props.checked).toBe(
      false,
    );
    const text = built.flatMap((node) => node.kids).filter((kid) => typeof kid === 'string');
    expect(text).toContain('ready');
    expect(text).toContain('no API key');
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

  const ZH_TITLE = '网页搜索（ModSearch）';
  const EN_TITLE = 'Web search (ModSearch)';

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
