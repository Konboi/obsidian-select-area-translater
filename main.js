"use strict";

const obsidian = require("obsidian");

const DEFAULT_SETTINGS = {
  endpoint: "",
  method: "POST",
  model: "",
  prompt:
    "次の日本語テキストを自然な英語に翻訳してください。訳文だけを返してください。",
  headers: JSON.stringify(
    {
      "Content-Type": "application/json",
    },
    null,
    2,
  ),
  bodyTemplate: JSON.stringify(
    {
      prompt: "{{prompt}}",
      text: "{{text}}",
    },
    null,
    2,
  ),
  responsePath: "text",
};

class SelectAreaTranslaterPlugin extends obsidian.Plugin {
  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("languages", "Translate dragged area", async () => {
      await this.translateDraggedArea();
    });

    this.addCommand({
      id: "translate-current-selection",
      name: "Translate current editor selection",
      editorCallback: async (editor) => {
        const selectedText = editor.getSelection().trim();
        if (!selectedText) {
          new obsidian.Notice("Translate target is empty.");
          return;
        }

        const cursor = editor.getCursor("to");
        await this.translateAndInsert(editor, selectedText, cursor.line + 1);
      },
    });

    this.addCommand({
      id: "translate-dragged-area",
      name: "Translate dragged editor area",
      callback: async () => {
        await this.translateDraggedArea();
      },
    });

    this.addSettingTab(new SelectAreaTranslaterSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async translateDraggedArea() {
    const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (!view) {
      new obsidian.Notice("Open a Markdown editor first.");
      return;
    }

    const editor = view.editor;
    const cmEditor = this.getCodeMirrorEditor(editor);
    if (!cmEditor) {
      new obsidian.Notice("Area selection is supported only in the Markdown editor.");
      return;
    }

    const selection = await this.captureAreaSelection(cmEditor, editor);
    if (!selection || !selection.text.trim()) {
      new obsidian.Notice("No text found in the selected area.");
      return;
    }

    const line = editor.offsetToPos(selection.to).line + 1;
    await this.translateAndInsert(editor, selection.text.trim(), line);
  }

  async translateAndInsert(editor, sourceText, insertLine) {
    if (!this.settings.endpoint.trim()) {
      new obsidian.Notice("Set the translation endpoint in plugin settings.");
      return;
    }

    const notice = new obsidian.Notice("Translating...", 0);

    try {
      const translated = await this.requestTranslation(sourceText);
      const targetLine = Math.min(insertLine, editor.lineCount());
      const insertPos = { line: targetLine, ch: 0 };
      const prefix = targetLine > 0 ? "\n" : "";
      editor.replaceRange(`${prefix}${translated}\n`, insertPos);
      if (typeof notice.hide === "function") {
        notice.hide();
      }
      new obsidian.Notice("Translation inserted.");
    } catch (error) {
      if (typeof notice.hide === "function") {
        notice.hide();
      }
      const message = error instanceof Error ? error.message : String(error);
      new obsidian.Notice(`Translation failed: ${message}`);
    }
  }

  async requestTranslation(sourceText) {
    const headers = this.parseJson(this.settings.headers, "headers");
    const body = this.interpolateTemplate(this.settings.bodyTemplate, {
      model: this.settings.model,
      prompt: this.settings.prompt,
      text: sourceText,
    });

    const response = await obsidian.requestUrl({
      url: this.settings.endpoint,
      method: this.settings.method || "POST",
      headers,
      body: this.settings.method.toUpperCase() === "GET" ? undefined : body,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${response.text}`);
    }

    const contentType = response.headers["content-type"] || "";
    if (!contentType.includes("application/json")) {
      return response.text.trim();
    }

    const payload = response.json;
    const value = this.readPath(payload, this.settings.responsePath.trim());
    if (typeof value !== "string") {
      throw new Error(`Response path "${this.settings.responsePath}" is not a string.`);
    }

    return value.trim();
  }

  parseJson(value, fieldName) {
    try {
      return JSON.parse(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid ${fieldName} JSON: ${message}`);
    }
  }

  interpolateTemplate(template, values) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return JSON.stringify(values[key] || "").slice(1, -1);
    });
  }

  applyPreset(name) {
    if (name === "ollama") {
      this.settings.endpoint = "http://127.0.0.1:11434/api/generate";
      this.settings.method = "POST";
      this.settings.model = "qwen2.5:7b";
      this.settings.prompt =
        "次の日本語テキストを自然な英語に翻訳してください。訳文だけを返してください。";
      this.settings.headers = JSON.stringify(
        {
          "Content-Type": "application/json",
        },
        null,
        2,
      );
      this.settings.bodyTemplate = JSON.stringify(
        {
          model: "{{model}}",
          prompt: "{{prompt}}\n\n{{text}}",
          stream: false,
        },
        null,
        2,
      );
      this.settings.responsePath = "response";
      return;
    }

    this.settings.endpoint = "http://127.0.0.1:1234/v1/chat/completions";
    this.settings.method = "POST";
    this.settings.model = "local-model";
    this.settings.prompt =
      "次の日本語テキストを自然な英語に翻訳してください。訳文だけを返してください。";
    this.settings.headers = JSON.stringify(
      {
        "Content-Type": "application/json",
      },
      null,
      2,
    );
    this.settings.bodyTemplate = JSON.stringify(
      {
        model: "{{model}}",
        messages: [
          {
            role: "system",
            content: "{{prompt}}",
          },
          {
            role: "user",
            content: "{{text}}",
          },
        ],
        temperature: 0.2,
      },
      null,
      2,
    );
    this.settings.responsePath = "choices.0.message.content";
  }

  readPath(payload, path) {
    if (!path) {
      return payload;
    }

    return path.split(".").reduce((current, segment) => {
      if (current === null || current === undefined) {
        return undefined;
      }

      const index = Number(segment);
      if (Array.isArray(current) && Number.isInteger(index)) {
        return current[index];
      }

      if (typeof current === "object" && segment in current) {
        return current[segment];
      }

      return undefined;
    }, payload);
  }

  getCodeMirrorEditor(editor) {
    const cmEditor = editor.cm;
    if (!cmEditor || !cmEditor.dom || typeof cmEditor.posAtCoords !== "function") {
      return null;
    }

    return cmEditor;
  }

  captureAreaSelection(cmEditor, editor) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "select-area-translater-overlay";

      const box = document.createElement("div");
      box.className = "select-area-translater-box";
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      let startX = 0;
      let startY = 0;
      let currentX = 0;
      let currentY = 0;
      let active = false;

      const cleanup = (result) => {
        overlay.removeEventListener("pointerdown", onPointerDown);
        overlay.removeEventListener("pointermove", onPointerMove);
        overlay.removeEventListener("pointerup", onPointerUp);
        overlay.removeEventListener("keydown", onKeyDown);
        overlay.remove();
        resolve(result);
      };

      const updateBox = () => {
        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;
      };

      const onPointerDown = (event) => {
        active = true;
        startX = event.clientX;
        startY = event.clientY;
        currentX = event.clientX;
        currentY = event.clientY;
        updateBox();
      };

      const onPointerMove = (event) => {
        if (!active) {
          return;
        }

        currentX = event.clientX;
        currentY = event.clientY;
        updateBox();
      };

      const onPointerUp = () => {
        if (!active) {
          cleanup(null);
          return;
        }

        const left = Math.min(startX, currentX);
        const right = Math.max(startX, currentX);
        const top = Math.min(startY, currentY);
        const bottom = Math.max(startY, currentY);

        const from = cmEditor.posAtCoords({ x: left, y: top });
        const to = cmEditor.posAtCoords({ x: right, y: bottom });

        if (from === null || to === null) {
          cleanup(null);
          return;
        }

        const start = Math.min(from, to);
        const end = Math.max(from, to);
        const text = editor.getRange(editor.offsetToPos(start), editor.offsetToPos(end));
        cleanup({ from: start, to: end, text });
      };

      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          cleanup(null);
        }
      };

      overlay.addEventListener("pointerdown", onPointerDown);
      overlay.addEventListener("pointermove", onPointerMove);
      overlay.addEventListener("pointerup", onPointerUp);
      overlay.addEventListener("keydown", onKeyDown);
      overlay.tabIndex = -1;
      overlay.focus();
    });
  }
}

class SelectAreaTranslaterSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new obsidian.Setting(containerEl)
      .setName("Preset")
      .setDesc("Apply a starter config for common local LLM APIs.")
      .addButton((button) =>
        button.setButtonText("Use Ollama").onClick(async () => {
          this.plugin.applyPreset("ollama");
          await this.plugin.saveSettings();
          this.display();
        }),
      )
      .addButton((button) =>
        button.setButtonText("Use OpenAI-compatible").onClick(async () => {
          this.plugin.applyPreset("openai-compatible");
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    new obsidian.Setting(containerEl)
      .setName("Endpoint URL")
      .setDesc("Translation request target.")
      .addText((text) =>
        text
          .setPlaceholder("https://example.com/translate")
          .setValue(this.plugin.settings.endpoint)
          .onChange(async (value) => {
            this.plugin.settings.endpoint = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new obsidian.Setting(containerEl)
      .setName("HTTP method")
      .setDesc("Usually POST.")
      .addText((text) =>
        text.setValue(this.plugin.settings.method).onChange(async (value) => {
          this.plugin.settings.method = value.trim().toUpperCase() || "POST";
          await this.plugin.saveSettings();
        }),
      );

    new obsidian.Setting(containerEl)
      .setName("Model")
      .setDesc("Template variable for {{model}}.")
      .addText((text) =>
        text.setValue(this.plugin.settings.model).onChange(async (value) => {
          this.plugin.settings.model = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new obsidian.Setting(containerEl)
      .setName("Prompt")
      .setDesc("Sent with the selected text.")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.prompt).onChange(async (value) => {
          this.plugin.settings.prompt = value;
          await this.plugin.saveSettings();
        }),
      );

    new obsidian.Setting(containerEl)
      .setName("Headers JSON")
      .setDesc("Example: Authorization or Content-Type.")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.headers).onChange(async (value) => {
          this.plugin.settings.headers = value;
          await this.plugin.saveSettings();
        }),
      );

    new obsidian.Setting(containerEl)
      .setName("Body template")
      .setDesc("Use {{prompt}} and {{text}} placeholders.")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.bodyTemplate).onChange(async (value) => {
          this.plugin.settings.bodyTemplate = value;
          await this.plugin.saveSettings();
        }),
      );

    new obsidian.Setting(containerEl)
      .setName("Response path")
      .setDesc("Dot path for JSON responses, for example choices.0.message.content.")
      .addText((text) =>
        text.setValue(this.plugin.settings.responsePath).onChange(async (value) => {
          this.plugin.settings.responsePath = value.trim();
          await this.plugin.saveSettings();
        }),
      );
  }
}

module.exports = SelectAreaTranslaterPlugin;
