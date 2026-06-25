# Privacy

ZenTao Bug Assistant connects only to the ZenTao server configured by the user.

- Login sessions and optional passwords are stored with VS Code SecretStorage.
- Bug prompt files and downloaded images are stored locally under the extension global storage directory.
- The extension does not send telemetry or debug logs to third-party services.
- AI repair prompts are sent only through the selected local workflow: Chat paste/open action or CLI command.

Teams should review generated prompts before sharing them with external AI services, especially when bug reports contain screenshots, logs, customer names, or internal URLs.
