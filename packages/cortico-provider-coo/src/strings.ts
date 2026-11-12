import { pick, type Language } from 'cortico/core/language.ts';
import { cooText as zhHant } from './strings.zh-Hant.ts';
import { cooText as ja } from './strings.ja.ts';
import { cooText as ko } from './strings.ko.ts';
import { cooText as fr } from './strings.fr.ts';
import { cooText as de } from './strings.de.ts';
import { cooText as es419 } from './strings.es-419.ts';
import { cooText as ptBR } from './strings.pt-BR.ts';
import { cooText as it } from './strings.it.ts';
import { cooText as ru } from './strings.ru.ts';

/** What the console shows of this provider: its description, the thinking levels, the protocol setting and its error. */
const zh = {
  /** `names`: the services' names in the console's language. */
  description: (names: readonly string[]) => `一个模块接 ${names.join('、')};按接口地址识别是哪一家、走哪种协议。思考可调节四档。`,
  tiers: { off: '不思考', low: '思考 · 快', high: '思考 · 标准', max: '思考 · 最深' },
  protocol: '协议',
  protocolHint: '留空时,列出的服务用它自己的协议,其他地址用 responses。responses:POST <地址>/responses;chat:POST <地址>/chat/completions;anthropic:Messages API,地址填写 /v1 之前的部分;gemini:Gemini API,地址填写 /models 之前的部分。',
  badProtocol: (protocols: string) => `协议只能是 ${protocols}`,
  httpRemote: "远程地址只能用 https:http 不加密，API Key 和对话会明文传输。本机和局域网的地址可以用 http。",
  catalog: {
    invalid: '模型列表请求的配置无效，请检查 API 地址、协议和 API Key。',
    keyRequired: '请填写 API Key；修改连接地址、协议或密钥变量后需要重新填写。',
    unsupported: '此服务未提供兼容的模型列表，请手动填写模型 ID。',
    timeout: '获取模型列表超时，请重试。',
  },
  chatgpt: {
    /** The sign-in section's title in the endpoint editor. */
    panel: 'ChatGPT 账号',
    description: '用 ChatGPT 账号登录，请求计入该账号的 ChatGPT 套餐用量。',
    /** Why the endpoint is not ready. */
    signedOut: '未登录 ChatGPT',
    /** The browser's page after the sign-in comes back. */
    returnToApp: '登录结果在应用里显示，可以关闭这个页面。',
    /** What the sign-in's failure codes mean; any other code is shown as it is. */
    reasons: { access_denied: '没有同意授权', plan_not_granted: '这个账号没有授权使用 ChatGPT 套餐', invalid_token_response: '服务已应答，但响应格式不兼容', unsupported_country_region_territory: '所在地区不受该服务支持；支持的地区见 https://developers.openai.com/api/docs/supported-countries', timeout: '浏览器里的登录超时了' } as Record<string, string>,
  },
};

export const en: typeof zh = {
  description: (names: readonly string[]) => `One module for ${names.join(', ')}; the base URL tells which service it is and which protocol it takes. Thinking has four levels.`,
  tiers: { off: 'No thinking', low: 'Thinking · fast', high: 'Thinking · standard', max: 'Thinking · deepest' },
  protocol: 'Protocol',
  protocolHint: 'Unset: a listed service uses its own protocol, any other URL uses responses. responses: POST <URL>/responses; chat: POST <URL>/chat/completions; anthropic: the Messages API, with the URL before /v1; gemini: the Gemini API, with the URL before /models.',
  badProtocol: (protocols: string) => `The protocol must be one of ${protocols}`,
  httpRemote: "A remote address must use https: http is not encrypted, so the API Key and the conversation would travel in plain text. Addresses on this computer or the local network may use http.",
  catalog: {
    invalid: 'The model catalog configuration is invalid. Check the API URL, protocol and API Key.',
    keyRequired: 'Enter an API Key. A changed URL, protocol or secret variable requires a new key.',
    unsupported: 'This service does not expose a compatible model catalog. Enter the model ID manually.',
    timeout: 'Fetching the model catalog timed out. Try again.',
  },
  chatgpt: {
    panel: 'ChatGPT account',
    description: "Signs in with a ChatGPT account; requests count toward that account's ChatGPT plan.",
    signedOut: 'Not signed in to ChatGPT',
    returnToApp: 'The app shows how the sign-in went. You can close this tab.',
    reasons: { access_denied: 'access was not granted', plan_not_granted: 'the account did not allow use of its ChatGPT plan', invalid_token_response: 'the service answered, but the response format is incompatible', unsupported_country_region_territory: 'your region is not supported by this service; supported regions: https://developers.openai.com/api/docs/supported-countries', timeout: 'the browser sign-in timed out' },
  },
};

export const cooText = (language: Language) => pick(language, {
  zh, en, 'zh-Hant': zhHant, ja, ko, fr, de, 'es-419': es419, 'pt-BR': ptBR, it, ru,
});

/** A sign-in failure code (`SignInStatus.reason`) in `language`: the known ones in words, any other as it is. */
export const signInReason = (code: string, language: Language): string => cooText(language).chatgpt.reasons[code] ?? code;
