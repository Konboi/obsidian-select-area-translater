# Select Area Translater

Obsidian plugin for translating selected text through a configurable HTTP endpoint and inserting the result below the selected area.

## What It Does

- Translate the current text selection in a Markdown editor
- Drag over an area in the editor and translate the text covered by that region
- Send the selected text plus a prompt to a configurable endpoint
- Insert the translated result directly under the selected content
- Configure presets for local LLM APIs such as Ollama and OpenAI-compatible servers

## Current Scope

This plugin currently targets the Markdown editing view in Obsidian.

- Supported: Markdown editor selection
- Supported: Dragged area selection in the editor
- Not yet supported: Reading view area selection
- Not yet supported: PDF area selection

## Installation

### Manual Install

1. Open your Obsidian vault.
2. Create a plugin folder under `.obsidian/plugins/select-area-translater`.
3. Copy these files into that folder:
   - `manifest.json`
   - `main.js`
   - `styles.css`
4. In Obsidian, open `Settings` -> `Community plugins`.
5. Refresh community plugins and enable `Select Area Translater`.

## Commands

- `Translate current editor selection`
- `Translate dragged editor area`

You can run them from the command palette.

## Settings

### Core Settings

- `Endpoint URL`: HTTP endpoint for translation requests
- `HTTP method`: usually `POST`
- `Model`: value available as `{{model}}` in the request template
- `Prompt`: instruction sent along with the selected text
- `Headers JSON`: request headers as JSON
- `Body template`: request body template with placeholders
- `Response path`: dot path used to extract translated text from JSON responses

### Template Variables

The `Body template` supports these placeholders:

- `{{model}}`
- `{{prompt}}`
- `{{text}}`

## Presets

### Ollama

Use the `Use Ollama` preset in plugin settings.

Default values:

- Endpoint: `http://127.0.0.1:11434/api/generate`
- Response path: `response`

Request body:

```json
{
  "model": "{{model}}",
  "prompt": "{{prompt}}\n\n{{text}}",
  "stream": false
}
```

### OpenAI-Compatible

Use the `Use OpenAI-compatible` preset in plugin settings.

Default values:

- Endpoint: `http://127.0.0.1:1234/v1/chat/completions`
- Response path: `choices.0.message.content`

Request body:

```json
{
  "model": "{{model}}",
  "messages": [
    {
      "role": "system",
      "content": "{{prompt}}"
    },
    {
      "role": "user",
      "content": "{{text}}"
    }
  ],
  "temperature": 0.2
}
```

## Example Workflow

1. Write text in Japanese in an Obsidian note.
2. Select the text directly or use the dragged area command.
3. The plugin sends the selected text and prompt to your configured local LLM endpoint.
4. The translated text is inserted below the selected region.

## Development

This repository includes TypeScript source and a committed `main.js` for direct plugin loading.

Files:

- `main.ts`: source implementation
- `main.js`: distributable plugin entry
- `manifest.json`: Obsidian plugin manifest
- `styles.css`: overlay styles for dragged area selection

### Build

```bash
npm install
npm run build
```

If your environment uses `mise`, make sure `node` and `npm` are available in `PATH`.

## Notes

- The plugin uses Obsidian's `requestUrl` API for HTTP calls.
- This avoids common browser-side CORS limitations when talking to local endpoints.

## License

MIT
