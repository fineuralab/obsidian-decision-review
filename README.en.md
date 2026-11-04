# Decision Review

[简体中文](README.md)

Record the reasons behind a decision, revisit what actually happened, and keep a practical lesson for next time.

**0.1.6 desktop preview**, for Obsidian 1.8.7 or newer. English and Simplified Chinese interfaces. All records stay in your vault; no account, network service or AI provider is required.

This patch stops old forms and settings requests after the plugin is disabled, preventing an obsolete instance from overwriting the current data-folder setting. Opening a view during startup now waits for the workspace to be ready. See the [audit report](docs/bug-audit-0.1.6.md).

## Install

1. Download `decision-review-0.1.6.zip` from [GitHub Releases](https://github.com/fineuralab/obsidian-decision-review/releases/tag/0.1.6) and unzip it.
2. Copy the `decision-review` folder to `<vault>/.obsidian/plugins/`.
3. Ensure `main.js`, `manifest.json` and `styles.css` sit directly inside that folder.
4. Reload Obsidian and enable **Decision Review** under Settings → Community plugins.
5. Click the book icon in the ribbon or run **Decision Review: Open Decision Review**.

The ZIP is ready to install. A source ZIP must be built before installation. This release has not been submitted to the community plugin directory.

This desktop preview was tested on macOS with Obsidian 1.8.7. Windows, Linux and newer host versions have not completed native acceptance testing.

When upgrading, copy any unsaved input, replace the three runtime files and fully reload Obsidian once. This clears forms and callbacks left in memory by the previous version. Existing vault data needs no migration.

## Record and revisit a decision

Choose **Record decision** and fill in what you decided, your main reason and the expected outcome. The decision date defaults to today. The next review defaults to 30 calendar days later; change or clear it as needed. Other options, assumptions and references are optional.

The **Due reviews** queue contains observing decisions scheduled for today or earlier. **All decisions** also includes future, unscheduled and closed decisions. Search covers reasons, expectations, reviews, notes and saved lessons.

The comparison shows the original reasoning alongside the latest review. Each review records what happened and asks you to choose **Met expectations**, **Partially met**, **Not met**, or **Too early to tell**. You can schedule another review, continue without a date, or close follow-up. Closing preserves history; reopening remains available.

Use **Correct record** for a correction and **Add a note** for later thoughts. Corrections preserve the original. A version picker lets you inspect changes, and each review retains its reference version. Review corrections preserve their earlier versions and leave the follow-up schedule unchanged.

## References and lessons

Choose existing vault notes or files, or add HTTP(S) URLs. Files open through Obsidian. Renaming a referenced file or folder updates structured paths, including history and open reference selections. Deleted references remain visible with a missing-file label. Moves made while the plugin is disabled cannot always be inferred; select the file again.

Use **Save as lesson note** to edit a title and a practical next step, then save an independent Markdown note with a source decision/review link. Repeating the action opens the existing note. Correcting a review does not rewrite a saved lesson. A missing lesson can be saved as a new copy.

## Data and recovery

The data folder is configurable. Its initial name follows the interface language (`Decision Review` or `决策复盘`); changing the interface language later does not rename it. Use a visible folder; no path segment may start with a dot. New records use this layout:

```text
<data folder>/
  决策-<stable ID>.md
  经验/经验-<decision ID>-<review ID>.md
  演示数据/...
```

Each decision file stores structured YAML and readable Markdown. Add personal text below `<!-- decision-review:notes -->`; the plugin preserves that section. Edit generated records through the plugin forms. Lesson note content can be edited normally.

Saving checks the entire source against the version originally opened. If another edit intervened, saving stops and your input stays in the form. Copy it, close the form, reopen and retry. Invalid YAML, duplicate IDs, missing markers and unsupported versions are reported by file; affected records cannot be overwritten. Repair them and click **Reload**.

Disabling the plugin leaves unsaved input in old forms and blocks those forms from saving, including after re-enabling. Copy the input and open a fresh form from the current instance.

**Move to trash** moves the decision file and all its embedded history to vault trash; referenced files and independent lesson notes remain. Demo data is viewed separately. Clearing it only moves verified, marked demo records and lessons to trash, preserving unmarked files.

The plugin does not merge simultaneous multi-device edits. Resolve sync conflicts before editing the same record again. Notifications are inside the plugin and optional status bar; there are no operating-system reminders.

## Settings and commands

Settings include interface language, default review interval (7/14/30/90 days), data folder, status-bar count, demo load/clear and reload. Changing the folder setting does not move old data; moving the current data folder inside Obsidian updates its location.

Commands: Open Decision Review, Record a decision, View due reviews, Review a decision, Open lesson notes. The review command uses the active note's references when possible, otherwise offering a decision picker.

## Build and verify

Requires Node.js 22+, npm and Python 3 for packaging:

```sh
npm ci
npm test
npm run build
npm run package
```

The package command creates an installation ZIP, a source ZIP and `SHA256SUMS.txt` in `dist/`. See [verification](docs/verification.md) for automated and real Obsidian checks, and [data format](docs/data-format.md) for the storage contract. The earlier [browser prototype](prototype/index.html) remains a separate design reference; its browser data is not imported into the plugin.

Desktop light/dark themes and narrow panes are covered. Mobile support, AI suggestions, probability calibration, automatic summaries and multi-option scoring are outside this release.

Report problems or suggestions through [Issues](https://github.com/fineuralab/obsidian-decision-review/issues). Include the plugin version, Obsidian version, operating system, reproduction steps and expected behavior. Use sample data without personal information.

MIT. The bundled YAML parser uses the ISC license; see `THIRD-PARTY-NOTICES.txt`.
