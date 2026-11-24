// Browser half of the modsearch dsh plugin: the settings card.
//
// dsh web users have no terminal, so `modsearch config set` is out of reach
// there and an engine key had no way in. dsh renders no generic form from a
// settings schema, so this card is contributed through a slot rather than
// declared as one: `plugins.bundle.config` on the Plugins page from dsh
// 0.1.6-alpha.2 on, `settings.plugin.item` in Settings before. It reads and
// writes the plugin's own route, which owns ~/.modsearch/config.json: the
// browser never sees an API key, and never sends a blank one back over a
// stored one.
//
// Hand-written in the lazy-CJS bundle protocol (window.__ModuleLoader__.load
// with a factory returning cordis-plugin exports), so no build step and no
// imports from dsh client packages: the same zero-dependency stance as the
// host half.
window.__ModuleLoader__.load({
  id: '@liustack/modsearch',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    // The engines the card offers, in the order the docs introduce them. The
    // host half carries the same list; both sides name what they show.
    var ENGINES = [
      'antigravity-cli',
      'tavily',
      'exa',
      'firecrawl',
      'keenable',
      'youcom',
      'grok-cli',
      'local',
    ];

    // Engines that search with no key and no signup.
    var KEYLESS_ENGINES = ['firecrawl', 'keenable', 'youcom'];

    // The chain is a row of search engines, so the page fetcher is not in it.
    // `local` reads a URL it is handed and searches for nothing, and a tickbox
    // among these would invite a decision that changes no search.
    var CHAIN_ENGINES = ENGINES.filter((name) => name !== 'local');

    // The Plugins page dispatches a bundle's configuration by npm package name.
    var PACKAGE_NAME = '@liustack/modsearch';

    // Two short label sets rather than a locale bundle: the card has a couple
    // of dozen strings, and a bundle would be more machinery than the thing it
    // labels.
    var TEXT = {
      en: {
        title: 'Search engine (ModSearch)',
        subtitle: 'Search engine provider configuration.',
        // The heading on the Plugins page, which already names the plugin.
        section: 'Engine settings',
        automatic: 'Automatic (chain order decides)',
        // The keyless default is stated in the list, where an engine is chosen.
        keylessSuffix: ' (keyless free tier)',
        pickToConfigure: 'Pick an engine above to configure its key and endpoint.',
        engine: 'Preferred engine',
        apiKey: 'API key',
        apiKeyHint:
          'Separate multiple keys with commas. ModSearch rotates to the next key after authentication, rate-limit, or quota failures.',
        baseUrl: 'Base URL',
        model: 'Model',
        stored: 'stored, leave empty to keep it',
        unset: 'not set',
        endpointFallback: 'Built-in official endpoint, leave blank to use it',
        modelFallback: 'engine default',
        save: 'Save',
        saving: 'saving...',
        saved: 'saved',
        loading: 'loading...',
        discard: 'Discard',
        cliNote: 'This engine runs a local command-line tool: no key, no endpoint.',
        localNote: 'The built-in fetcher reads pages directly: no key, no endpoint.',
        youcomNote:
          "Runs on You.com's keyless free tier (100 searches a day per IP): no key, no endpoint.",
        envNote:
          'This key comes from an environment variable, which overrides the config file. Clear the variable to let a saved key take effect.',
        autoTitle: 'Automatic engine chain',
        autoHint: 'Checked engines may join failover. Only engines ready here are listed.',
        autoUnknown: 'Engine status is unavailable right now, so every engine is listed.',
        autoEmpty: 'No engine is ready on this machine yet.',
        // Two engine-specific asides, each rendered by a branch of its own so
        // either can be dropped without touching the rest of the card.
        socialOnly: 'X search only',
        keylessTier: 'Runs on the keyless free tier by default. Add a key to raise the quota.',
        loadFailed: 'load failed',
        saveFailed: 'save failed',
        retry: 'Retry',
        fetchTitle: 'Page fetch (web_fetch)',
        fetchLabel: 'Fetch pages through ModSearch',
        fetchHint:
          "Off: dsh's local fetch, free with no quota. On: ModSearch's page readers, which read pages local fetch cannot and share the free search allowance. Applies at once.",
      },
      zh: {
        // 不叫「网页搜索」：dsh 自带一张「网页搜索（DeepSeek 搜索提供方）」卡片，
        // 同一份列表里两个开头一样的名字谁也认不出来。这个名字与同门插件的
        // 「视觉引擎（ModLens）」成对。
        title: '搜索引擎（ModSearch）',
        subtitle: '搜索引擎提供商配置。',
        section: '引擎设置',
        automatic: '自动（按故障转移顺序）',
        keylessSuffix: '（免注册免费）',
        pickToConfigure: '在上面选一个引擎，才能配置它的密钥和地址。',
        engine: '首选引擎',
        apiKey: 'API 密钥',
        apiKeyHint: '多个密钥用英文逗号分隔。鉴权、限流或配额失败时会自动轮换到下一个密钥。',
        baseUrl: '接口地址',
        model: '模型',
        stored: '已保存，留空即不改动',
        unset: '未设置',
        endpointFallback: '内置官方地址，留空即可使用',
        modelFallback: '使用该引擎默认值',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        loading: '加载中…',
        discard: '放弃修改',
        cliNote: '该引擎走本机命令行工具，无需密钥和接口地址。',
        localNote: '内置抓取器直连读取网页，无需密钥和接口地址。',
        youcomNote: '走 You.com 免注册免费额度（每个 IP 每天 100 次），无需密钥和接口地址。',
        envNote: '该密钥来自环境变量，环境变量优先于配置文件。清掉变量后保存的密钥才会生效。',
        autoTitle: '自动引擎链',
        autoHint: '勾选后可参与故障转移。这里只列出本机已就绪的引擎。',
        autoUnknown: '暂时读不到引擎状态，所以列出全部引擎。',
        autoEmpty: '本机暂无就绪的引擎。',
        socialOnly: '仅 X 搜索',
        keylessTier: '默认使用免注册的免费额度，填入密钥可提高配额。',
        loadFailed: '加载失败',
        saveFailed: '保存失败',
        retry: '重试',
        fetchTitle: '网页抓取（web_fetch）',
        fetchLabel: '网页抓取也走 ModSearch',
        fetchHint:
          '关闭时走 dsh 本地抓取，免费不限次。打开后走 ModSearch 的读取链，能读本地抓不到的页面，和搜索共用免费额度。改动立即生效。',
      },
    };

    // The copy this card speaks. `active` is dsh's own interface language,
    // when its locale service was there to say. Asked first because the page
    // language is not an answer: the built index.html freezes
    // `<html lang="zh-CN">` and never rewrites it, so a user set to English
    // would still read a Chinese card. Absent the service (older hosts,
    // profiles that ship no locale) the page then the browser decide.
    function labels(active) {
      var lang = (
        active ||
        document.documentElement.lang ||
        navigator.language ||
        'en'
      ).toLowerCase();
      return lang.indexOf('zh') === 0 ? TEXT.zh : TEXT.en;
    }

    // What the footer says when a request fails. Whatever the server said
    // travels untranslated ('unknown engine: x', a path error): that is the
    // diagnosis, and mapping it to error codes would buy a translation table
    // with a much larger contact surface than this card is worth. Only the
    // silent case, where there is no detail to show, gets a localized line.
    function noteFrom(error, fallback) {
      // An Error whose message is empty is the no-detail case, not a thing to
      // stringify: String(error) on it reads 'Error'.
      var detail =
        error && typeof error.message === 'string' ? error.message : error ? String(error) : '';
      return detail || fallback;
    }

    /** Whether this engine has a key and an endpoint to configure at all. */
    function keyed(summary, engine) {
      return engine !== '' && (summary.keyed || []).indexOf(engine) >= 0;
    }

    /** Whether a run reads this engine's `model` setting. */
    function modelled(summary, engine) {
      return engine !== '' && (summary.models || []).indexOf(engine) >= 0;
    }

    // The next draft when the engine changes or a summary arrives. The fields
    // belong to the newly selected engine, so switching engines can never copy
    // one engine's endpoint onto another.
    function nextDraft(summary, engine, keepEnabled) {
      // engine '' is its own answer: not pinned, availability decides. There
      // is then no single engine whose key belongs in these fields, so they
      // stay empty and the card says how to get them back.
      var current = summary.engines?.[engine] || { baseURL: '', model: '' };
      return {
        engine: engine,
        apiKey: '',
        baseURL: current.baseURL || '',
        model: current.model || '',
        enabled: Object.assign(
          {},
          keepEnabled ||
            Object.fromEntries(
              ENGINES.map((name) => [name, summary.engines?.[name]?.enabled !== false]),
            ),
        ),
      };
    }

    /**
     * Select a preferred engine, and make that preference usable where the user
     * can see it happen.
     *
     * Only an engine with a checkbox on screen gets switched on here. Ticking a
     * hidden one would be a change nobody asked for and nobody can see, and the
     * save that followed would delete an `enabled: false` the user never knew
     * was there. An engine with no row keeps whatever the file says: the
     * preference still travels, and the router says plainly when a pinned
     * engine is switched off.
     */
    function selectEngine(summary, draft, engine) {
      var next = nextDraft(summary, engine, draft.enabled);
      if (engine !== '' && chainEngines(summary).indexOf(engine) >= 0) {
        next.enabled[engine] = true;
      }
      return next;
    }

    /** Change automatic participation, clearing an impossible preference. */
    function toggleEngine(draft, engine, enabled) {
      var next = Object.assign({}, draft, { enabled: Object.assign({}, draft.enabled) });
      next.enabled[engine] = enabled;
      if (!enabled && next.engine === engine) {
        next.engine = '';
      }
      return next;
    }

    // What one save is actually about. The pin travels only when the select
    // moved; the engine fields only when they were edited, and only the fields
    // that engine actually has. A save that always carried everything would
    // pin an engine nobody chose and write the values the card loaded back
    // over whatever the file holds now.
    function savePayload(summary, draft) {
      var payload = {};
      var enabled = {};
      // Only the engines the chain actually rendered. An engine with no
      // checkbox had no way to change, so naming it here could only carry an
      // edit the card made to itself.
      chainEngines(summary).forEach((name) => {
        var before = summary.engines?.[name]?.enabled !== false;
        var after = draft.enabled?.[name] !== false;
        if (after !== before) {
          enabled[name] = after;
        }
      });
      if (Object.keys(enabled).length > 0) {
        payload.enabled = enabled;
      }
      if (draft.engine !== summary.engine) {
        payload.engine = draft.engine;
      }
      var pristine = nextDraft(summary, draft.engine);
      var canKey = keyed(summary, draft.engine);
      var canModel = modelled(summary, draft.engine);
      var edited =
        (canKey && (draft.apiKey !== '' || draft.baseURL !== pristine.baseURL)) ||
        (canModel && draft.model !== pristine.model);
      if (draft.engine !== '' && edited) {
        payload.target = draft.engine;
        if (canKey) {
          payload.apiKey = draft.apiKey;
          payload.baseURL = draft.baseURL;
        }
        if (canModel) {
          payload.model = draft.model;
        }
      }
      return payload;
    }

    /**
     * The engines the preference list offers. `local` is not one of them: it
     * fetches a URL it is handed, so pinning it as the search engine pins
     * something that searches nothing.
     *
     * It stays listed while the config file still names it, because the select
     * has to show what is configured. Dropping the option there would leave
     * some other engine sitting in the box as if it were the preference, which
     * is the card lying about the file it edits.
     */
    function preferable(summary, draft) {
      if (summary.engine === 'local' || draft.engine === 'local') {
        return ENGINES;
      }
      return CHAIN_ENGINES;
    }

    /**
     * The engines the chain offers a checkbox for: the ones doctor found ready
     * on this machine. An engine that cannot run here is not a decision the
     * user has to make, and a row saying so is a row they cannot act on.
     *
     * `readiness` absent means the probe never answered, which is not a verdict
     * that nothing works here. Every search engine stays listed then, because
     * the checkbox is the only way back on and the card must not take it away
     * over a fact it does not know.
     *
     * This list is also what a save is allowed to say about `enabled`: what was
     * never on screen was never edited.
     */
    function chainEngines(summary) {
      var probes = Array.isArray(summary.readiness) ? summary.readiness : null;
      if (probes === null) {
        return CHAIN_ENGINES;
      }
      return CHAIN_ENGINES.filter((name) =>
        probes.some((entry) => entry.engine === name && entry.ready === true),
      );
    }

    /**
     * How to render the API key field so the characters are hidden.
     *
     * A real password input makes Safari's iCloud Keychain offer to enable
     * autofill for the site and then pop its bubble on every focus, for a
     * field that is always empty: the key lives in the config file and the
     * host never sends it here, only whether one is stored. `autocomplete`
     * cannot turn that off, because WebKit ignores it on password fields on
     * purpose. Masking with text-security gets the same hidden characters
     * without ever being a password field, and it also keeps a key meant for
     * one machine out of a synced keychain.
     *
     * Feature-detected rather than assumed. Where the property is missing the
     * field stays a password input: the nuisance is worth more than the
     * alternative, which is somebody's API key rendered in clear text while
     * they type it.
     *
     * This is a trade, and the cost falls on people who are not in the room. A
     * password input carries a protected state into the accessibility tree,
     * and screen readers stop reading characters back because of it. Masking
     * is only paint: VoiceOver and NVDA will read this key aloud, and ARIA has
     * no equivalent to restore. Accepted here because the field is empty in
     * normal use, so what a screen reader can read back is what the user is
     * typing at that moment, not a stored secret.
     */
    function supportsTextSecurity() {
      // A throwing `supports` counts as no support. The spec says the two
      // argument form returns false for an unknown property rather than
      // throwing, but this runs inside render, where an exception takes the
      // whole settings surface down instead of costing one field.
      try {
        return (
          typeof CSS === 'object' &&
          CSS !== null &&
          typeof CSS.supports === 'function' &&
          CSS.supports('-webkit-text-security', 'disc') === true
        );
      } catch {
        return false;
      }
    }

    function secretFieldProps() {
      if (!supportsTextSecurity()) {
        return { type: 'password' };
      }
      return {
        type: 'text',
        autoComplete: 'off',
        autoCorrect: 'off',
        autoCapitalize: 'off',
        spellCheck: false,
        style: { WebkitTextSecurity: 'disc' },
      };
    }

    // Native <select> popups honor color-scheme, not inherit color. WebView2
    // still paints that popup as light unless a scheme is declared, so the
    // control must set one and give each option its own background.
    function parseCssColor(value) {
      if (typeof value !== 'string') {
        return null;
      }
      const s = value.trim();
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
      if (hex) {
        const h = hex[1];
        if (h.length === 3) {
          return [
            parseInt(h.charAt(0) + h.charAt(0), 16),
            parseInt(h.charAt(1) + h.charAt(1), 16),
            parseInt(h.charAt(2) + h.charAt(2), 16),
          ];
        }
        return [
          parseInt(h.slice(0, 2), 16),
          parseInt(h.slice(2, 4), 16),
          parseInt(h.slice(4, 6), 16),
        ];
      }
      const rgb =
        /^rgba?\(\s*([0-9]*\.?[0-9]+)(?:\s*,\s*|\s+)([0-9]*\.?[0-9]+)(?:\s*,\s*|\s+)([0-9]*\.?[0-9]+)/i.exec(
          s,
        );
      if (!rgb) {
        return null;
      }
      return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    }

    function cardThemeIsDark() {
      if (typeof getComputedStyle === 'function') {
        try {
          const target = document.body || document.documentElement;
          const rgb = parseCssColor(getComputedStyle(target).color);
          if (rgb) {
            const luminance =
              0.2126 * (rgb[0] / 255) + 0.7152 * (rgb[1] / 255) + 0.0722 * (rgb[2] / 255);
            return luminance > 0.5;
          }
        } catch {
          // Unreadable computed color is not a theme answer.
        }
      }
      const media =
        typeof matchMedia === 'function'
          ? matchMedia
          : typeof window.matchMedia === 'function'
            ? window.matchMedia
            : null;
      if (typeof media === 'function') {
        try {
          if (media('(prefers-color-scheme: dark)').matches === true) {
            return true;
          }
        } catch {
          // A throwing matchMedia is not a theme answer.
        }
      }
      return false;
    }

    // A live handle on an optional dsh service with a getSnapshot/subscribe
    // pair (the locale service, the web settings form). Each has an inject of
    // its own, so it can land after a card mounted, be replaced, or go away,
    // and a card that only looked at mount kept the page language for good
    // (#54). The handle is itself subscribable: a subscriber hears the
    // service changing as well as the state changing inside it.
    function serviceHandle() {
      var current = null;
      var watchers = new Set();
      function swap(locale) {
        current = locale;
        for (var watcher of Array.from(watchers)) {
          watcher();
        }
      }
      return {
        get: () => current,
        // Hands back the release for this service only: scope teardown order
        // is the host's, so a stale release must not detach its replacement.
        set: (locale) => {
          swap(locale);
          return () => {
            if (current === locale) {
              swap(null);
            }
          };
        },
        subscribe: (onChange) => {
          var follow = (locale) => (locale ? locale.subscribe(onChange) : () => {});
          var unfollow = follow(current);
          var watcher = () => {
            unfollow();
            unfollow = follow(current);
            onChange();
          };
          watchers.add(watcher);
          return () => {
            watchers.delete(watcher);
            unfollow();
          };
        },
      };
    }

    // `locale` and `webForm` are serviceHandle()s, both optional. Without
    // locale, labels() takes the page language. Without webForm (a host with
    // no configForms service) the web_fetch switch is not offered.
    function ConfigCard(react, ui, locale, webForm) {
      var h = react.createElement;
      var Input = ui.Input;

      // Built once per card so useSyncExternalStore is not handed a new
      // subscribe on every render, which would resubscribe every render.
      var subscribeLocale = (onChange) => (locale ? locale.subscribe(onChange) : () => {});
      var readLocale = () => {
        var service = locale?.get();
        return service ? service.getSnapshot().active : '';
      };
      var subscribeForm = (onChange) => (webForm ? webForm.subscribe(onChange) : () => {});
      // The form's snapshot keeps its reference until it changes, which is
      // what useSyncExternalStore asks of a snapshot.
      var readForm = () => {
        var form = webForm?.get();
        return form ? form.getSnapshot() : null;
      };

      // The chrome is the native plugin card's, value for value (border,
      // layer backgrounds, 12px radius, header row with a rotating chevron,
      // footer with discard ghost + save primary), so this card reads as a
      // sibling of the built-in ones rather than a lodger.
      var chevron = (open) =>
        h(
          'svg',
          {
            width: 16,
            height: 16,
            viewBox: '0 0 16 16',
            style: {
              color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
              flex: 'none',
              transition: 'transform .16s',
              transform: open ? 'rotate(180deg)' : 'none',
            },
          },
          h('path', {
            d: 'M4 6l4 4 4-4',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.5,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        );

      // `view` is the Plugins page's question (dsh 0.1.6-alpha.2 on): 'page'
      // for the form on the bundle's page, 'summary' for a one-liner.
      // Settings on older hosts passes none and gets the collapsible card.
      return function ModsearchCard(props) {
        var view = props ? props.view : undefined;
        // Subscribed, not sampled: the language is a live setting, and a card
        // sitting open while the user switches has to follow. getSnapshot and
        // subscribe are the pair dsh documents as useSyncExternalStore-safe.
        // That hook is React 18 and up; where it is missing the language is
        // read once per render instead, which still follows a switch as soon
        // as anything re-renders the card. The branch is on a closure
        // constant, so hook order never varies within one card.
        var t = labels(
          typeof react.useSyncExternalStore === 'function'
            ? react.useSyncExternalStore(subscribeLocale, readLocale)
            : readLocale(),
        );
        var webSettings =
          typeof react.useSyncExternalStore === 'function'
            ? react.useSyncExternalStore(subscribeForm, readForm)
            : readForm();
        var openState = react.useState(false);
        var summaryState = react.useState(null);
        var draftState = react.useState(null);
        var noteState = react.useState('');
        // The page already heads the form with the plugin's title, so the form
        // is open from the start there: a collapsed block under that title
        // would ask for the same click twice.
        var open = view === 'page' || openState[0];
        var summary = summaryState[0];
        var draft = draftState[0];
        var note = noteState[0];

        var load = react.useCallback(() => {
          // doctor: the offline self-check saying which engines are set up
          // here. Paid once per expand, cached host-side.
          fetch('/modsearch/config?doctor=1')
            .then((r) =>
              r.json().then((body) => {
                if (!r.ok) {
                  throw new Error(body.error || '');
                }
                return body;
              }),
            )
            .then((next) => {
              summaryState[1](next);
              draftState[1](nextDraft(next, next.engine));
              noteState[1]('');
            })
            .catch((error) => {
              noteState[1](noteFrom(error, t.loadFailed));
            });
        }, []);

        react.useEffect(() => {
          if (open && summary === null) {
            load();
          }
        }, [open, summary, load]);

        // Readiness after a save, which is the only moment it can have changed
        // under this card: the key just written is exactly what makes an engine
        // ready. Only the readiness list is replaced, so the fields keep their
        // saved values and nothing on screen blinks back to a loading state.
        // A probe that fails leaves the previous answer and the saved note
        // alone: the save landed, and a failed follow-up is not its news.
        var refreshReadiness = react.useCallback((saved) => {
          fetch('/modsearch/config?doctor=1')
            .then((r) => (r.ok ? r.json() : null))
            .then((fresh) => {
              if (fresh && Array.isArray(fresh.readiness)) {
                summaryState[1](Object.assign({}, saved, { readiness: fresh.readiness }));
              }
            })
            .catch(() => {});
        }, []);

        if (view === 'summary') {
          return t.subtitle;
        }

        // A row wrapping ONE control is a label, which names that control. A
        // row wrapping a set of them must not be: the label would become the
        // first control's accessible name and swallow the whole section's
        // prose. Those rows are a named group instead.
        var fieldRow = (label, control, key, groupName) =>
          h(
            groupName ? 'div' : 'label',
            {
              key: key,
              role: groupName ? 'group' : undefined,
              'aria-label': groupName || undefined,
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                padding: '12px 0',
                borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
              },
            },
            h(
              'div',
              { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary, inherit)' } },
              label,
            ),
            control,
          );

        var hint = (text, key) =>
          fieldRow(
            '',
            h(
              'div',
              {
                style: {
                  fontSize: '13px',
                  color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                },
              },
              text,
            ),
            key,
          );

        var body = null;
        if (open) {
          if (summary === null || draft === null) {
            // Before a summary exists, the only thing that writes a note is a
            // load that failed. The collapsible card retries on its next
            // expand, but the page never collapses, so a retry is offered
            // where the failure is shown.
            body = h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '12px 0',
                  color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                  fontSize: '13px',
                },
              },
              h('span', { role: 'status', style: { marginRight: 'auto' } }, note || t.loading),
              note
                ? h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => {
                        noteState[1]('');
                        load();
                      },
                      style: {
                        appearance: 'none',
                        font: 'inherit',
                        fontSize: '13px',
                        lineHeight: 1.5,
                        cursor: 'pointer',
                        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                        borderRadius: '8px',
                        padding: '5px 14px',
                        background: 'none',
                        color: 'var(--dsw-alias-label-secondary, inherit)',
                      },
                    },
                    t.retry,
                  )
                : null,
            );
          } else {
            const canKey = keyed(summary, draft.engine);
            const canModel = modelled(summary, draft.engine);
            const current = summary.engines?.[draft.engine] || { hasKey: false, keySource: null };
            const pristine = nextDraft(summary, draft.engine);
            // Availability and permission are separate. Doctor says whether an
            // engine can run here, and only those get a row. The checkbox says
            // whether automatic routing may use it. An unchecked engine keeps
            // its row: unticking it is not a reason to take the tickbox away,
            // and dsh web users have no terminal to undo that with.
            const chain = chainEngines(summary);
            // The same list savePayload measures, so the buttons can never
            // light up over a change no save would carry.
            const dirty =
              draft.engine !== summary.engine ||
              (canKey && (draft.apiKey !== '' || draft.baseURL !== pristine.baseURL)) ||
              (canModel && draft.model !== pristine.model) ||
              chain.some(
                (name) =>
                  (draft.enabled?.[name] !== false) !==
                  (summary.engines?.[name]?.enabled !== false),
              );

            const set = (key, value) => {
              var next = Object.assign({}, draft);
              next[key] = value;
              draftState[1](next);
              noteState[1]('');
            };

            const inputProps = (key, placeholder) => ({
              value: draft[key],
              placeholder: placeholder,
              onChange: (event) => {
                set(key, event.target.value);
              },
            });
            const textField = (label, key, placeholder) =>
              fieldRow(
                label,
                h(Input, Object.assign(inputProps(key, placeholder), { type: 'text' })),
                key,
              );
            // Its own function rather than a `type` string the caller has to
            // spell right. A sentinel compared with `===` fails open: one
            // typo, or a later edit passing 'text', and the key renders in
            // clear text with every test still green.
            const secretField = (label, key, placeholder) =>
              fieldRow(
                label,
                h(Input, Object.assign(inputProps(key, placeholder), secretFieldProps())),
                key,
              );

            const chainNote = !Array.isArray(summary.readiness)
              ? t.autoUnknown
              : chain.length === 0
                ? t.autoEmpty
                : '';
            const statusRows = chain.map((name) => {
              const checked = draft.enabled?.[name] !== false;
              return h(
                'label',
                {
                  key: name,
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    minHeight: '32px',
                    padding: '4px 10px',
                    border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                    borderRadius: '8px',
                    background: checked
                      ? 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.08))'
                      : 'transparent',
                    cursor: 'pointer',
                    fontSize: '13px',
                  },
                },
                // No aria-label. This label wraps exactly one control, so its
                // text is the checkbox's accessible name, and that text is the
                // whole row: an aria-label of just the engine name would name
                // the box over the label and leave the aside beside it unread.
                h('input', {
                  type: 'checkbox',
                  checked,
                  onChange: (event) => {
                    draftState[1](toggleEngine(draft, name, event.target.checked));
                    noteState[1]('');
                  },
                }),
                h('span', null, name),
                // grok-cli serves the social role alone: it never joins
                // web-search failover, and an unmarked tickbox in a row of
                // search engines would promise that it does.
                name === 'grok-cli'
                  ? h(
                      'span',
                      {
                        style: {
                          color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                          fontSize: '12px',
                        },
                      },
                      t.socialOnly,
                    )
                  : null,
              );
            });

            // web_fetch's provider is dsh's own setting, so this switch writes
            // it through dsh's settings forms the moment it is clicked rather
            // than riding the Save button, which writes the config file.
            // Off returns to the composed default when that is local fetch,
            // so no override is left behind, and pins local fetch otherwise.
            const form = webForm?.get();
            const fetchRow =
              form && webSettings && webSettings.status === 'ready' && webSettings.writable
                ? fieldRow(
                    t.fetchTitle,
                    h(
                      'label',
                      {
                        style: {
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '8px',
                          cursor: 'pointer',
                          fontSize: '13px',
                        },
                      },
                      h('input', {
                        type: 'checkbox',
                        'data-setting': 'fetchProvider',
                        checked: webSettings.value?.fetchProvider === 'modsearch',
                        onChange: (event) => {
                          var target = event.target.checked ? 'modsearch' : 'http';
                          var write =
                            webSettings.base?.fetchProvider === target
                              ? form.unset('fetchProvider')
                              : form.set('fetchProvider', target);
                          noteState[1]('');
                          write
                            .then((accepted) => {
                              if (!accepted) {
                                noteState[1](t.saveFailed);
                              }
                            })
                            .catch((error) => {
                              noteState[1](noteFrom(error, t.saveFailed));
                            });
                        },
                      }),
                      h(
                        'span',
                        null,
                        t.fetchLabel,
                        h(
                          'span',
                          {
                            style: {
                              display: 'block',
                              marginTop: '2px',
                              color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                            },
                          },
                          t.fetchHint,
                        ),
                      ),
                    ),
                    'fetch',
                    t.fetchTitle,
                  )
                : null;

            const darkCard = cardThemeIsDark();
            const optionPaint = darkCard
              ? { color: '#f2f2f2', background: '#23262a' }
              : { color: '#23262a', background: '#f2f2f2' };
            body = h(
              'div',
              null,
              fieldRow(
                t.engine,
                h(
                  'select',
                  {
                    value: draft.engine,
                    onChange: (event) => {
                      draftState[1](selectEngine(summary, draft, event.target.value));
                      noteState[1]('');
                    },
                    style: {
                      appearance: 'none',
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                      background: 'transparent',
                      color: 'inherit',
                      font: 'inherit',
                      fontSize: '13px',
                      colorScheme: darkCard ? 'dark' : 'light',
                    },
                  },
                  [h('option', { key: '', value: '', style: optionPaint }, t.automatic)].concat(
                    preferable(summary, draft).map((name) =>
                      h(
                        'option',
                        { key: name, value: name, style: optionPaint },
                        KEYLESS_ENGINES.indexOf(name) >= 0 ? `${name}${t.keylessSuffix}` : name,
                      ),
                    ),
                  ),
                ),
                'engine',
              ),
              draft.engine === ''
                ? hint(t.pickToConfigure, 'unpinned')
                : canKey
                  ? secretField(t.apiKey, 'apiKey', current.hasKey ? t.stored : t.unset)
                  : hint(
                      draft.engine === 'local'
                        ? t.localNote
                        : draft.engine === 'youcom'
                          ? t.youcomNote
                          : t.cliNote,
                      'keyless',
                    ),
              canKey ? hint(t.apiKeyHint, 'api-key-rotation') : null,
              // The keyless engines ask for no signup at all. Silence here
              // reads as a key being required, which is the one thing these
              // engines do not need.
              // A keyless engine with no key field (youcom) has its own note above.
              canKey && KEYLESS_ENGINES.indexOf(draft.engine) >= 0 && !current.hasKey
                ? hint(t.keylessTier, 'keyless-tier')
                : null,
              canKey ? textField(t.baseUrl, 'baseURL', t.endpointFallback) : null,
              // Where the key is coming from, said once: a save cannot beat an
              // environment variable, and silence here would read as the save
              // having done nothing.
              canKey && current.keySource === 'env' ? hint(t.envNote, 'envnote') : null,
              canModel ? textField(t.model, 'model', t.modelFallback) : null,
              fieldRow(
                h(
                  'span',
                  null,
                  t.autoTitle,
                  h(
                    'span',
                    {
                      style: {
                        color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                        fontWeight: 400,
                        marginLeft: '8px',
                      },
                    },
                    t.autoHint,
                  ),
                ),
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      paddingTop: '2px',
                    },
                  },
                  statusRows.length > 0
                    ? h(
                        'div',
                        {
                          key: 'engines',
                          style: { display: 'flex', flexWrap: 'wrap', gap: '10px 18px' },
                        },
                        statusRows,
                      )
                    : null,
                  chainNote
                    ? h(
                        'div',
                        {
                          key: 'note',
                          style: {
                            fontSize: '13px',
                            color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                          },
                        },
                        chainNote,
                      )
                    : null,
                ),
                'status',
                t.autoTitle,
              ),
              fetchRow,
              h(
                'div',
                {
                  key: 'footer',
                  style: {
                    borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '12px 0 4px',
                  },
                },
                h(
                  'span',
                  {
                    role: 'status',
                    style: {
                      marginRight: 'auto',
                      fontSize: '12px',
                      color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                    },
                  },
                  note,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: !dirty || note === t.saving,
                    onClick: () => {
                      draftState[1](nextDraft(summary, summary.engine));
                      noteState[1]('');
                    },
                    style: {
                      appearance: 'none',
                      font: 'inherit',
                      fontSize: '13px',
                      lineHeight: 1.5,
                      cursor: dirty ? 'pointer' : 'default',
                      border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                      borderRadius: '8px',
                      padding: '5px 14px',
                      background: 'none',
                      color: 'var(--dsw-alias-label-secondary, inherit)',
                      opacity: dirty ? 1 : 0.4,
                    },
                  },
                  t.discard,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: !dirty || note === t.saving,
                    onClick: () => {
                      noteState[1](t.saving);
                      fetch('/modsearch/config', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify(savePayload(summary, draft)),
                      })
                        .then((r) =>
                          r.json().then((payload) => {
                            if (!r.ok) {
                              throw new Error(payload.error || '');
                            }
                            return payload;
                          }),
                        )
                        .then((next) => {
                          // The save response carries no doctor run, so the
                          // statuses already on screen stand until the fresh
                          // probe below answers.
                          next.readiness = summary.readiness;
                          summaryState[1](next);
                          draftState[1](nextDraft(next, next.engine));
                          noteState[1](t.saved);
                          refreshReadiness(next);
                        })
                        .catch((error) => {
                          noteState[1](noteFrom(error, t.saveFailed));
                        });
                    },
                    style: {
                      appearance: 'none',
                      font: 'inherit',
                      fontSize: '13px',
                      lineHeight: 1.5,
                      cursor: dirty ? 'pointer' : 'default',
                      border: '1px solid transparent',
                      borderRadius: '8px',
                      padding: '5px 14px',
                      background: 'var(--dsw-alias-label-primary, currentColor)',
                      color: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))',
                      opacity: dirty ? 1 : 0.4,
                    },
                  },
                  t.save,
                ),
              ),
            );
          }
        }

        if (view === 'page') {
          // Sized like the page's own section headings, so the form reads as
          // one more section of the bundle's page.
          return h(
            'div',
            null,
            h(
              'h4',
              {
                style: { margin: '0 0 4px', fontSize: '14px', lineHeight: '20px', fontWeight: 500 },
              },
              t.section,
            ),
            body,
          );
        }

        return h(
          'div',
          {
            style: {
              border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
              background: open
                ? 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))'
                : 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))',
              borderRadius: '12px',
              transition: 'border-color .16s, background .16s',
            },
          },
          h(
            'button',
            {
              type: 'button',
              'aria-expanded': open,
              onClick: () => {
                openState[1](!open);
              },
              style: {
                appearance: 'none',
                width: '100%',
                font: 'inherit',
                color: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
                background: 'none',
                border: 0,
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px 16px',
              },
            },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: '14px', fontWeight: 600 } }, t.title),
              h(
                'div',
                {
                  style: {
                    color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                    fontSize: '13px',
                    lineHeight: 1.5,
                  },
                },
                t.subtitle,
              ),
            ),
            chevron(open),
          ),
          open ? h('div', { style: { margin: '0 16px', paddingBottom: '8px' } }, body) : null,
        );
      };
    }

    function registerCard(ctx) {
      // Reaching for an undeclared service throws in cordis, so each optional
      // dependency rides a scoped ctx.inject of its own: the closure runs
      // where the service exists and never runs where it does not, exactly as
      // the host half takes webServer.
      if (typeof ctx.inject !== 'function') {
        return;
      }

      // dsh's language service gets an inject of its own, and fills a handle
      // the card reads later. Listing it beside slots would be worse than
      // useless: ctx.inject waits for every service named, so on a host that
      // never provides locale the card would never register at all. Here a
      // missing service just leaves the handle empty, and the card falls back
      // to the page language.
      var locale = serviceHandle();
      ctx.inject(['locale'], (scope) => {
        var release = locale.set(scope.locale);
        if (typeof scope.effect === 'function') {
          scope.effect(() => release, 'modsearch: locale handle');
        }
      });

      // dsh's settings forms, for the web_fetch switch. Optional the same
      // way: hosts before configForms never fill this and show no switch.
      var webForm = serviceHandle();
      ctx.inject(['configForms'], (scope) => {
        var release = webForm.set(scope.configForms.get('web'));
        if (typeof scope.effect === 'function') {
          scope.effect(() => release, 'modsearch: web settings handle');
        }
      });

      ctx.inject(['slots'], (scope) => {
        // The card and its route live and die together: with the host route
        // off (settingsCard: false, or no web profile) a card would only
        // render an error, which is not what turning a feature off means. Any
        // response at all proves the route exists; only a 404 or a network
        // failure reads as absent.
        fetch('/modsearch/config')
          .then((response) => {
            if (response.status === 404) {
              return;
            }
            try {
              mountCard(scope, locale, webForm);
            } catch (error) {
              console.error(`[modsearch] settings card skipped: ${error}`);
            }
          })
          .catch(() => {});
      });
    }

    function mountCard(ctx, locale, webForm) {
      var react;
      try {
        react = require('react');
      } catch (error) {
        console.error(`[modsearch] settings card skipped: ${error}`);
        return;
      }
      var ui = require('@deepseek-ai/dsh-client-ui-primitives');
      var Card = ConfigCard(react, ui, locale, webForm);
      // slots.inject waits until a slot is declared, so each host fills the
      // one it has and the other wait never fires: from dsh 0.1.6-alpha.2 on
      // hosts declare only the Plugins page's, older ones only the Settings
      // one.
      ctx.slots.inject('plugins.bundle.config', function* () {
        yield ctx.slots.register({ name: 'plugins.bundle.config', key: PACKAGE_NAME }, Card);
      });
      ctx.slots.inject('settings.plugin.item', function* () {
        // id for rc.6's list slot, key for rc.7's keyed one: one client serves
        // both, and the key has to match the settings namespace the host half
        // registers or the card silently never renders.
        yield ctx.slots.register(
          { name: 'settings.plugin.item', id: 'modsearch', key: 'modsearch', order: 31 },
          Card,
        );
      });
    }

    function apply(ctx) {
      registerCard(ctx);
    }

    exports.apply = apply;
    // Exposed for the repo's tests only; not part of the plugin contract.
    exports.__card = {
      nextDraft: nextDraft,
      selectEngine: selectEngine,
      toggleEngine: toggleEngine,
      savePayload: savePayload,
      secretFieldProps: secretFieldProps,
      ConfigCard: ConfigCard,
      serviceHandle: serviceHandle,
    };
    // `slots` and `locale` are both optional, so neither is required here:
    // registerCard takes each on its own scoped inject.
    exports.inject = [];
    return module.exports;
  },
});
