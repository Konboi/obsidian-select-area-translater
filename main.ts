import {
  App,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
} from "obsidian";

type ApiFormat = "openai-chat-completions" | "ollama-generate";
type PresetName = "ollama" | "openai-compatible";

interface SelectAreaTranslaterSettings {
  endpoint: string;
  method: string;
  apiFormat: ApiFormat;
  model: string;
  prompt: string;
  headers: string;
}

const DEFAULT_SETTINGS: SelectAreaTranslaterSettings = {
  endpoint: "",
  method: "POST",
  apiFormat: "openai-chat-completions",
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
};

export default class SelectAreaTranslaterPlugin extends Plugin {
  settings!: SelectAreaTranslaterSettings;
  modelOptions: string[] = [];

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
    const response = await requestUrl({
      url: this.settings.endpoint,
      method: this.settings.method || "POST",
      headers,
      body: this.settings.method.toUpperCase() === "GET" ? undefined : this.buildRequestBody(sourceText),
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${response.text}`);
    }

    const contentType = response.headers["content-type"] ?? "";
    if (!contentType.includes("application/json")) {
      return response.text.trim();
    }

    const translated = this.extractResponseText(response.json);
    if (!translated) {
      throw new Error("Could not extract translated text from the response.");
    }

    return translated.trim();
  }

  private parseJson<T>(value: string, fieldName: string): T {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid ${fieldName} JSON: ${message}`);
    }
  }

  private buildRequestBody(sourceText: string): string {
    if (!this.settings.model.trim()) {
      throw new Error("Set a model before sending translation requests.");
    }

    if (this.settings.apiFormat === "ollama-generate") {
      return JSON.stringify({
        model: this.settings.model,
        prompt: `${this.settings.prompt}\n\n${sourceText}`,
        stream: false,
      });
    }

    return JSON.stringify({
      model: this.settings.model,
      messages: [
        {
          role: "system",
          content: this.settings.prompt,
        },
        {
          role: "user",
          content: sourceText,
        },
      ],
      temperature: 0.2,
    });
  }

  private extractResponseText(payload: unknown): string | undefined {
    if (this.settings.apiFormat === "ollama-generate") {
      if (this.isRecord(payload) && typeof payload.response === "string") {
        return payload.response;
      }
      return undefined;
    }

    if (!this.isRecord(payload) || !Array.isArray(payload.choices)) {
      return undefined;
    }

    const firstChoice = payload.choices[0];
    if (!this.isRecord(firstChoice) || !this.isRecord(firstChoice.message)) {
      return undefined;
    }

    return typeof firstChoice.message.content === "string"
      ? firstChoice.message.content
      : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  applyPreset(name: PresetName): void {
    if (name === "ollama") {
      this.settings.endpoint = "http://127.0.0.1:11434/api/generate";
      this.settings.method = "POST";
      this.settings.apiFormat = "ollama-generate";
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
      this.modelOptions = [];
      return;
    }

    this.settings.endpoint = "http://127.0.0.1:1234/v1/chat/completions";
    this.settings.method = "POST";
    this.settings.apiFormat = "openai-chat-completions";
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
    this.modelOptions = [];
  }

  async refreshModels(): Promise<void> {
    if (!this.settings.endpoint.trim()) {
      throw new Error("Set the endpoint URL before loading models.");
    }

    const headers = this.parseJson<Record<string, string>>(
      this.settings.headers,
      "headers",
    );
    const response = await requestUrl({
      url: this.getModelsEndpoint(),
      method: "GET",
      headers,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${response.text}`);
    }

    this.modelOptions = this.extractModelOptions(response.json);
    if (this.modelOptions.length === 0) {
      throw new Error("No models were returned by the API.");
    }

    if (!this.modelOptions.includes(this.settings.model)) {
      this.settings.model = this.modelOptions[0];
      await this.saveSettings();
    }
  }

  private getModelsEndpoint(): string {
    const endpoint = new URL(this.settings.endpoint);
    if (this.settings.apiFormat === "ollama-generate") {
      endpoint.pathname = endpoint.pathname.replace(/\/api\/(generate|chat)$/, "/api/tags");
      return endpoint.toString();
    }

    endpoint.pathname = endpoint.pathname.replace(
      /\/v\d+\/(chat\/completions|completions|responses)$/,
      "/v1/models",
    );
    return endpoint.toString();
  }

  private extractModelOptions(payload: unknown): string[] {
    if (this.settings.apiFormat === "ollama-generate") {
      if (!this.isRecord(payload) || !Array.isArray(payload.models)) {
        return [];
      }

      return payload.models
        .map((model) => {
          if (!this.isRecord(model)) {
            return null;
          }
          if (typeof model.model === "string") {
            return model.model;
          }
          if (typeof model.name === "string") {
            return model.name;
          }
          return null;
        })
        .filter((model): model is string => Boolean(model));
    }

    if (!this.isRecord(payload) || !Array.isArray(payload.data)) {
      return [];
    }

    return payload.data
      .map((model) => {
        if (!this.isRecord(model) || typeof model.id !== "string") {
          return null;
        }
        return model.id;
      })
      .filter((model): model is string => Boolean(model));
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
            this.plugin.modelOptions = [];
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
      .setName("API format")
      .setDesc("How requests and model lists are interpreted.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("openai-chat-completions", "OpenAI-compatible")
          .addOption("ollama-generate", "Ollama")
          .setValue(this.plugin.settings.apiFormat)
          .onChange(async (value: ApiFormat) => {
            this.plugin.settings.apiFormat = value;
            this.plugin.modelOptions = [];
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Load available models from the API or enter one manually.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Choose a loaded model");
        for (const model of this.plugin.modelOptions) {
          dropdown.addOption(model, model);
        }

        dropdown
          .setValue(this.plugin.modelOptions.includes(this.plugin.settings.model) ? this.plugin.settings.model : "")
          .onChange(async (value) => {
            if (!value) {
              return;
            }
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
            this.display();
          });
      })
      .addButton((button) =>
        button.setButtonText("Refresh").onClick(async () => {
          try {
            await this.plugin.refreshModels();
            new Notice(`Loaded ${this.plugin.modelOptions.length} models.`);
            this.display();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Loading models failed: ${message}`);
          }
        }),
      )
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
      .setDesc("Use this for API keys or custom headers.")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.headers).onChange(async (value) => {
          this.plugin.settings.headers = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
