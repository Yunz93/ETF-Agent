export const CURRENCY = {
  CNY: "¥",
  HKD: "HK$",
  USD: "$",
};

export const FX_TO_CNY = {
  CNY: 1,
  HKD: 0.92,
  USD: 7.25,
};

export const DEFAULT_SOURCES = {
  A: [
    {
      name: "巨潮资讯网",
      url: "https://www.cninfo.com.cn/new/index",
      role: "公告、财报与监管问询来源",
    },
    {
      name: "上交所",
      url: "https://www.sse.com.cn/",
      role: "沪市公告补充校验",
    },
  ],
  HK: [
    {
      name: "HKEXnews",
      url: "https://www.hkexnews.hk/index.htm",
      role: "港股上市公司公告来源",
    },
  ],
  US: [
    {
      name: "SEC EDGAR",
      url: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
      role: "10-K、10-Q、XBRL companyfacts 来源",
    },
  ],
  QUOTE: [
    {
      name: "腾讯行情",
      url: "https://gu.qq.com/",
      role: "实时/延迟行情和基础估值",
    },
  ],
};
export const PAGE_SIZE = 50;
export const QUOTE_BATCH_SIZE = 200;
export const RESEARCH_INDICES = [
  { code: "000001", name: "上证指数", market: "A" },
  { code: "399106", name: "深证综指", market: "A" },
  { code: "HSI", name: "恒生指数", market: "HK" },
  { code: "SPX", name: "标普500", market: "US" },
];




export const WATCHLIST_KEY = "stockagent.watchlist";
export const HOLDINGS_KEY = "stockagent.holdings";
export const NOTES_KEY = "stockagent.notes";
export const ALERTS_KEY = "stockagent.alertHistory";
export const PREFS_KEY = "stockagent.prefs";
export const THEME_KEY = "stockagent.theme";
export const SIDEBAR_KEY = "stockagent.sidebar";
export const SIDEBAR_COLLAPSE_MIN = 1181;
export const CUSTOM_KEY = "stockagent.customSymbols";
export const WORKSPACE_CACHE_KEY = "stockagent.workspace.cache";
export const WORKSPACE_SYNC_DEBOUNCE_MS = 500;

export const GROUP_LABELS = {
  core: "核心仓",
  watch: "观察",
  long: "长期",
};

export const DECISION_LABELS = {
  watch: "观望",
  buy: "关注买入",
  hold: "持有",
  trim: "减仓",
  exit: "移出",
};

export const PAGE_TITLES = {
  workbench: "今日工作台",
  watchlist: "自选跟踪",
  holdings: "持仓",
  research: "研究池",
  detail: "股票详情",
  settings: "设置",
};
export const AI_PROVIDER_PRESETS = {
  deepseek: {
    provider_name: "DeepSeek",
    base_url: "https://api.deepseek.com",
    model: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    docs_url: "https://platform.deepseek.com/api_keys",
    note: "官方 OpenAI 兼容接口，推荐默认",
    needs_api_key: true,
  },
  openai: {
    provider_name: "OpenAI",
    base_url: "https://api.openai.com",
    model: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "o4-mini"],
    docs_url: "https://platform.openai.com/api-keys",
    note: "官方 Chat Completions",
    needs_api_key: true,
  },
  moonshot: {
    provider_name: "Moonshot / Kimi",
    base_url: "https://api.moonshot.cn",
    model: "moonshot-v1-auto",
    models: ["moonshot-v1-auto", "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k", "kimi-latest"],
    docs_url: "https://platform.moonshot.cn/console/api-keys",
    note: "月之暗面 Kimi，OpenAI 兼容",
    needs_api_key: true,
  },
  qwen: {
    provider_name: "通义千问 / DashScope",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode",
    model: "qwen-plus",
    models: ["qwen-plus", "qwen-turbo", "qwen-max", "qwen-long"],
    docs_url: "https://bailian.console.aliyun.com/",
    note: "阿里云百炼兼容模式",
    needs_api_key: true,
  },
  zhipu: {
    provider_name: "智谱 GLM",
    base_url: "https://open.bigmodel.cn/api/paas",
    model: "glm-4-flash",
    models: ["glm-4-flash", "glm-4-air", "glm-4-plus", "glm-4.5-flash"],
    docs_url: "https://open.bigmodel.cn/usercenter/apikeys",
    note: "BigModel OpenAI 兼容（/v4）",
    needs_api_key: true,
  },
  siliconflow: {
    provider_name: "SiliconFlow 硅基流动",
    base_url: "https://api.siliconflow.cn",
    model: "deepseek-ai/DeepSeek-V3",
    models: ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen2.5-72B-Instruct", "THUDM/glm-4-9b-chat"],
    docs_url: "https://cloud.siliconflow.cn/account/ak",
    note: "聚合多家开源模型的 Token 服务",
    needs_api_key: true,
  },
  openrouter: {
    provider_name: "OpenRouter",
    base_url: "https://openrouter.ai/api",
    model: "deepseek/deepseek-chat",
    models: ["deepseek/deepseek-chat", "deepseek/deepseek-r1", "openai/gpt-4o-mini", "google/gemini-2.0-flash-001", "anthropic/claude-3.5-sonnet"],
    docs_url: "https://openrouter.ai/keys",
    note: "统一路由多家模型",
    needs_api_key: true,
  },
  groq: {
    provider_name: "Groq",
    base_url: "https://api.groq.com/openai",
    model: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-20b"],
    docs_url: "https://console.groq.com/keys",
    note: "高速推理，OpenAI 兼容",
    needs_api_key: true,
  },
  ollama: {
    provider_name: "Ollama 本地",
    base_url: "http://127.0.0.1:11434",
    model: "llama3.1",
    models: ["llama3.1", "qwen2.5", "deepseek-r1", "mistral"],
    docs_url: "https://ollama.com/",
    note: "本机 Ollama，通常无需 API Key",
    needs_api_key: false,
  },
  custom: {
    provider_name: "自定义 OpenAI 兼容",
    base_url: "",
    model: "",
    models: [],
    docs_url: "",
    note: "任意兼容 /v1/chat/completions 的 Token 服务",
    needs_api_key: true,
  },
};
