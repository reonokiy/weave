# Weave development conventions

- Use English for code, identifiers, comments, new developer documentation, and the default interface locale.
- Use Vue I18n for all application-owned user-facing text, including accessibility labels, errors, placeholders, and status messages. Add semantic keys to `src/locales/en.json` first and keep `zh-CN.json` in sync. Avoid concatenating translated sentence fragments.
- The default and fallback locale are English. Respect only an explicit saved language choice; do not switch based on browser language. Keep UI locale separate from the account's post language.
- Keep user content and upstream server error details intact. Use locale-aware formatting for dates and numbers.
- Check GoToSocial source before introducing or changing API behavior. Record the exact source revision and relevant handlers, processing logic, and response models in the compatibility documentation. Do not assume Mastodon compatibility implies feature support.
- Preserve Vue, UnoCSS, and the existing layout. Run relevant tests and the production build after functional changes; verify `/weave/` builds when routing or deployment behavior changes.
