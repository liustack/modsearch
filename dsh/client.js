// Browser half of the modsearch dsh plugin: the settings card.
//
// dsh web users have no terminal, so `modsearch config set` is out of reach
// there and an engine key had no way in. dsh renders a fixed set of plugin
// cards and does not enumerate settings namespaces, so this card is
// contributed through the `settings.plugin.item` slot rather than declared as
// a schema. It reads and writes the plugin's own loopback route, which owns
// ~/.modsearch/config.json: the browser never sees an API key, and never
// sends a blank one back over a stored one.
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
    var ENGINES = ['antigravity-cli', 'tavily', 'exa', 'firecrawl', 'grok-cli', 'local'];

    // Two short label sets rather than a locale bundle: the card has a couple
    // of dozen strings, and a bundle would be more machinery than the thing it
    // labels.
    var TEXT = {
      en: {
        title: 'Web search (ModSearch)',
        subtitle: 'Search engine, API keys, and endpoints.',
        automatic: 'Automatic (chain order decides)',
        pickToConfigure: 'Pick an engine above to configure its key and endpoint.',
        engine: 'Preferred engine',
        apiKey: 'API key',
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
        envNote:
          'This key comes from an environment variable, which overrides the config file. Clear the variable to let a saved key take effect.',
        autoTitle: 'Automatic engine chain',
        autoHint: 'Checked engines may join failover. Readiness comes from modsearch doctor.',
        autoUnknown: 'engine status is unavailable right now',
        ready: 'ready',
        noKey: 'no API key',
        notInstalled: 'not installed',
        notReady: 'not ready',
        loadFailed: 'load failed',
        saveFailed: 'save failed',
      },
      zh: {
        title: '网页搜索（ModSearch）',
        subtitle: '搜索引擎、API 密钥与接口地址。',
        automatic: '自动（按故障转移顺序）',
        pickToConfigure: '在上面选一个引擎，才能配置它的密钥和地址。',
        engine: '首选引擎',
        apiKey: 'API 密钥',
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
        envNote: '该密钥来自环境变量，环境变量优先于配置文件。清掉变量后保存的密钥才会生效。',
        autoTitle: '自动引擎链',
        autoHint: '勾选后可参与故障转移。就绪状态来自 modsearch doctor。',
        autoUnknown: '暂时读不到引擎状态',
        ready: '就绪',
        noKey: '缺少密钥',
        notInstalled: '未安装',
        notReady: '未就绪',
        loadFailed: '加载失败',
        saveFailed: '保存失败',
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

    /** Select a preferred engine and make that preference usable. */
    function selectEngine(summary, draft, engine) {
      var next = nextDraft(summary, engine, draft.enabled);
      if (engine !== '') {
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
      ENGINES.forEach((name) => {
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

    /** The localized one-word verdict for one doctor entry. */
    function statusLabel(t, entry) {
      if (!entry) {
        return t.autoUnknown;
      }
      if (entry.ready === true) {
        return t.ready;
      }
      if (entry.keySource === null && /key/i.test(entry.reason || '')) {
        return t.noKey;
      }
      if (/not found|not installed|missing/i.test(entry.reason || '')) {
        return t.notInstalled;
      }
      return t.notReady;
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

    // `localeRef` is a { current } handle on dsh's locale service, not the
    // service itself: it is optional and may land after the card is built, so
    // it is read at render time rather than captured here. Absent, both
    // helpers below hand back nothing and labels() takes its old path.
    function ConfigCard(react, ui, localeRef) {
      var h = react.createElement;
      var Input = ui.Input;

      // Built once per card so useSyncExternalStore is not handed a new
      // subscribe on every render, which would resubscribe every render.
      var subscribeLocale = (onChange) => {
        var locale = localeRef?.current;
        return locale ? locale.subscribe(onChange) : () => {};
      };
      var readLocale = () => {
        var locale = localeRef?.current;
        return locale ? locale.getSnapshot().active : '';
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

      return function ModsearchCard() {
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
        var openState = react.useState(false);
        var summaryState = react.useState(null);
        var draftState = react.useState(null);
        var noteState = react.useState('');
        var open = openState[0];
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
            body = h(
              'div',
              {
                style: {
                  padding: '12px 0',
                  color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                  fontSize: '13px',
                },
              },
              note || t.loading,
            );
          } else {
            const canKey = keyed(summary, draft.engine);
            const canModel = modelled(summary, draft.engine);
            const current = summary.engines?.[draft.engine] || { hasKey: false, keySource: null };
            const pristine = nextDraft(summary, draft.engine);
            const dirty =
              draft.engine !== summary.engine ||
              (canKey && (draft.apiKey !== '' || draft.baseURL !== pristine.baseURL)) ||
              (canModel && draft.model !== pristine.model) ||
              ENGINES.some(
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

            // Availability and permission are separate. Doctor says whether an
            // engine can run here. The checkbox says whether automatic routing
            // may use it when it can.
            const probes = Array.isArray(summary.readiness) ? summary.readiness : null;
            const statusRows = ENGINES.map((name) => {
              const entry = probes?.find((candidate) => candidate.engine === name);
              const checked = draft.enabled?.[name] !== false;
              return h(
                'label',
                {
                  key: name,
                  title: entry?.reason || undefined,
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
                h('input', {
                  type: 'checkbox',
                  'aria-label': name,
                  checked,
                  onChange: (event) => {
                    draftState[1](toggleEngine(draft, name, event.target.checked));
                    noteState[1]('');
                  },
                }),
                h('span', null, name),
                h(
                  'span',
                  {
                    style: {
                      color:
                        entry?.ready === true
                          ? 'var(--dsw-alias-label-secondary, inherit)'
                          : 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                      fontSize: '12px',
                    },
                  },
                  statusLabel(t, entry),
                ),
              );
            });

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
                    },
                  },
                  [h('option', { key: '', value: '' }, t.automatic)].concat(
                    ENGINES.map((name) => h('option', { key: name, value: name }, name)),
                  ),
                ),
                'engine',
              ),
              draft.engine === ''
                ? hint(t.pickToConfigure, 'unpinned')
                : canKey
                  ? secretField(t.apiKey, 'apiKey', current.hasKey ? t.stored : t.unset)
                  : hint(draft.engine === 'local' ? t.localNote : t.cliNote, 'keyless'),
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
                      flexWrap: 'wrap',
                      gap: '10px 18px',
                      paddingTop: '2px',
                    },
                  },
                  statusRows,
                ),
                'status',
                t.autoTitle,
              ),
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
                          // The save response carries no doctor run; keep the
                          // statuses already on screen.
                          next.readiness = summary.readiness;
                          summaryState[1](next);
                          draftState[1](nextDraft(next, next.engine));
                          noteState[1](t.saved);
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
      var localeRef = { current: null };
      ctx.inject(['locale'], (scope) => {
        localeRef.current = scope.locale;
        if (typeof scope.effect === 'function') {
          scope.effect(
            () => () => {
              localeRef.current = null;
            },
            'modsearch: locale handle',
          );
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
              mountCard(scope, localeRef);
            } catch (error) {
              console.error(`[modsearch] settings card skipped: ${error}`);
            }
          })
          .catch(() => {});
      });
    }

    function mountCard(ctx, localeRef) {
      var react;
      try {
        react = require('react');
      } catch (error) {
        console.error(`[modsearch] settings card skipped: ${error}`);
        return;
      }
      var ui = require('@deepseek-ai/dsh-client-ui-primitives');
      var Card = ConfigCard(react, ui, localeRef);
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
    };
    // `slots` and `locale` are both optional, so neither is required here:
    // registerCard takes each on its own scoped inject.
    exports.inject = [];
    return module.exports;
  },
});
