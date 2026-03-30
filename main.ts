import {
  App,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
} from "obsidian";

interface SelectAreaTranslaterSettings {
  endpoint: string;
  method: string;
  model: string;
  prompt: string;
  headers: string;
  bodyTemplate: string;
  responsePath: string;
}

const DEFAULT_SETTINGS: SelectAreaTranslaterSettings = {
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

type PresetName = "ollama" | "openai-compatible";

export default class SelectAreaTranslaterPlugin extends Plugin {
  settings!: SelectAreaTranslaterSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon("languages", "Translate current selection", async () => {
      await this.translateActiveSelection();
    });

    this.addCommand({
      id: "translate-current-selection",
      name: "Translate current editor selection",
      callback: async () => {
        await this.translateActiveSelection();
      },
    });

    this.addSettingTab(new SelectAreaTranslaterSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async translateActiveSelection(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Open a Markdown editor first.");
      return;
    }

    const editor = view.editor;
    const selectedText = editor.getSelection().trim();
    if (!selectedText) {
      new Notice("Select text to translate first.");
      return;
    }

    const cursor = editor.getCursor("to");
    await this.translateAndInsert(editor, selectedText, cursor.line + 1);
  }

  private async translateAndInsert(
    editor: MarkdownView["editor"],
    sourceText: string,
    insertLine: number,
  ): Promise<void> {
    if (!this.settings.endpoint.trim()) {
      new Notice("Set the translation endpoint in plugin settings.");
      return;
    }

    const notice = new Notice("Translating...", 0);

    try {
      const translated = await this.requestTranslation(sourceText);
      const targetLine = Math.min(insertLine, editor.lineCount());
      const insertPos = { line: targetLine, ch: 0 };
      const prefix = targetLine > 0 ? "\n" : "";
      editor.replaceRange(`${prefix}${translated}\n`, insertPos);
      notice.hide();
      new Notice("Translation inserted.");
    } catch (error) {
      notice.hide();
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Translation failed: ${message}`);
    }
  }

  private async requestTranslation(sourceText: string): Promise<string> {
    const headers = this.parseJson<Record<string, string>>(
      this.settings.headers,
      "headers",
    );
    const body = this.interpolateTemplate(this.settings.bodyTemplate, {
      model: this.settings.model,
      prompt: this.settings.prompt,
      text: sourceText,
    });

    const response = await requestUrl({
      url: this.settings.endpoint,
      method: this.settings.method || "POST",
      headers,
      body: this.settings.method.toUpperCase() === "GET" ? undefined : body,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${response.text}`);
    }

    const contentType = response.headers["content-type"] ?? "";
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

  private parseJson<T>(value: string, fieldName: string): T {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid ${fieldName} JSON: ${message}`);
    }
  }

  private interpolateTemplate(
    template: string,
    values: Record<string, string>,
  ): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      return JSON.stringify(values[key] ?? "").slice(1, -1);
    });
  }

  applyPreset(name: PresetName): void {
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

  private readPath(payload: unknown, path: string): unknown {
    if (!path) {
      return payload;
    }

    return path.split(".").reduce<unknown>((current, segment) => {
      if (current === null || current === undefined) {
        return undefined;
      }

      const index = Number(segment);
      if (Array.isArray(current) && Number.isInteger(index)) {
        return current[index];
      }

      if (typeof current === "object" && segment in (current as Record<string, unknown>)) {
        return (current as Record<string, unknown>)[segment];
      }

      return undefined;
    }, payload);
  }

}

class SelectAreaTranslaterSettingTab extends PluginSettingTab {
  plugin: SelectAreaTranslaterPlugin;

  constructor(app: App, plugin: SelectAreaTranslaterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("HTTP method")
      .setDesc("Usually POST.")
      .addText((text) =>
        text.setValue(this.plugin.settings.method).onChange(async (value) => {
          this.plugin.settings.method = value.trim().toUpperCase() || "POST";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Template variable for {{model}}.")
      .addText((text) =>
        text.setValue(this.plugin.settings.model).onChange(async (value) => {
          this.plugin.settings.model = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Prompt")
      .setDesc("Sent with the selected text.")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.prompt).onChange(async (value) => {
          this.plugin.settings.prompt = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Headers JSON")
      .setDesc("Example: Authorization or Content-Type.")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.headers).onChange(async (value) => {
          this.plugin.settings.headers = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Body template")
      .setDesc("Use {{prompt}} and {{text}} placeholders.")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.bodyTemplate).onChange(async (value) => {
          this.plugin.settings.bodyTemplate = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
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
