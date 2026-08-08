# Contributing

Contributions to the Swaram software engine are welcome. Do not commit songs,
lyrics, private session exports, access tokens, model caches, generated stems,
or personally identifying evaluation data.

1. Create a focused branch and keep changes within the engine repository.
2. Preserve Malayalam as UTF-8 NFC and add tests for introduced behavior.
3. Run the quality gates documented in `README.md`; database and authorized
   audio tests remain explicit opt-ins.
4. Update contracts and both language implementations together when changing
   shared payloads.
5. Document privacy, retention, environment, migration, or operational changes.

When a change has multiple authors, preserve their attribution with Git
`Co-authored-by` trailers using an email connected to each contributor's GitHub
account.

Pull requests should state the behavior changed, commands actually run, test
results, migrations/configuration changes, and limitations. Never attach
private media to an issue or pull request. Use generated tones or original,
redistributable fixtures for tests.

Security vulnerabilities follow `SECURITY.md`, not public issue discussion.
