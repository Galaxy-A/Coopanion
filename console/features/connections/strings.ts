import { pick } from '../../base/language.ts';
import { S as zhHant } from './strings.zh-Hant.ts';
import { S as ja } from './strings.ja.ts';
import { S as ko } from './strings.ko.ts';
import { S as fr } from './strings.fr.ts';
import { S as de } from './strings.de.ts';
import { S as es419 } from './strings.es-419.ts';
import { S as ptBR } from './strings.pt-BR.ts';
import { S as it } from './strings.it.ts';
import { S as ru } from './strings.ru.ts';

const zh = {
  pool: '供应商池', add: '添加供应商', edit: '编辑供应商',
  search: '搜索名称、地址或模型', empty: '还没有供应商', noMatches: '没有匹配的供应商',
  current: '当前使用', ready: '已配置', needsSetup: '需要配置', selected: '已选择',
  use: '使用并开始', using: '正在启用...', started: '已启用，Coo 开始运行。',
  test: '测试连接', testing: '正在测试...', testOk: '连接正常', testFailed: '连接失败',
  refresh: '刷新', manage: '管理供应商', saved: '供应商已保存',
  preset: '服务预设', custom: '自定义服务', region: '平台', cn: '中国大陆', intl: '国际',
  name: '供应商名称', nameHint: '使用英文字母、数字、- 或 _，以字母或数字开头。',
  protocol: 'API 协议', url: 'API 地址', invalidUrl: '填写有效的 HTTP(S) 地址，不包含账号、查询串或片段。',
  httpsOnly: '公网 API 地址需要 HTTPS。', key: 'API Key', keyRequired: '填写 API Key，或选择无需密钥。',
  keepKey: '已保存，留空保留', showKey: '显示密钥', hideKey: '隐藏密钥', noAuth: '无需密钥',
  changedAddress: '地址或协议已改变，请重新填写密钥，或选择无需密钥。',
  model: '默认模型', fetchModels: '获取模型', fetching: '正在获取...', modelSearch: '搜索模型',
  noModels: '服务未返回模型，可手动填写模型 ID。', modelRequired: '填写或选择一个模型。',
  modelCount: (count: number) => `${count} 个模型`,
  manualModel: '模型 ID', request: '请求地址', getKey: '申请 API Key',
  more: '更多配置', reasoning: '推理强度', off: '关闭', low: '低', high: '高', max: '最高',
  images: '接受图片', context: '上下文上限', maxTokens: '最大输出 token',
  invalidNumber: '填写正整数；上下文上限必须大于最大输出。',
  save: '保存', saveUse: '保存并使用', saving: '正在保存...', cancel: '取消',
  required: '此项必填。', duplicate: '此名称已存在。', retry: '重试',
  account: 'ChatGPT 账号', saveAccount: '保存后登录 ChatGPT 账号。', signIn: '登录 ChatGPT',
  unsupported: '此供应商需要在高级模式中编辑。',
  savedNotStarted: '已保存，启用失败。可修正后再次使用。',
  paused: '已暂停', running: '运行中', notConnected: '暂未连接',
  discard: '放弃未保存的修改？', elapsed: (ms: number) => `${ms} ms`,
};

export const en: typeof zh = {
  pool: 'Provider pool', add: 'Add provider', edit: 'Edit provider',
  search: 'Search name, URL or model', empty: 'No providers yet', noMatches: 'No matching providers',
  current: 'In use', ready: 'Configured', needsSetup: 'Needs setup', selected: 'Selected',
  use: 'Use and start', using: 'Activating...', started: 'Enabled. Coo is running.',
  test: 'Test connection', testing: 'Testing...', testOk: 'Connection works', testFailed: 'Connection failed',
  refresh: 'Refresh', manage: 'Manage providers', saved: 'Provider saved',
  preset: 'Service preset', custom: 'Custom service', region: 'Platform', cn: 'Mainland China', intl: 'International',
  name: 'Provider name', nameHint: 'Use English letters, digits, - or _; start with a letter or digit.',
  protocol: 'API protocol', url: 'API URL', invalidUrl: 'Enter an HTTP(S) URL without credentials, a query or a fragment.',
  httpsOnly: 'Public API URLs require HTTPS.', key: 'API Key', keyRequired: 'Enter an API Key or select no authentication.',
  keepKey: 'Saved; leave empty to keep', showKey: 'Show key', hideKey: 'Hide key', noAuth: 'No authentication',
  changedAddress: 'The URL or protocol changed. Enter the key again or select no authentication.',
  model: 'Default model', fetchModels: 'Fetch models', fetching: 'Fetching...', modelSearch: 'Search models',
  noModels: 'The service returned no models. Enter a model ID manually.', modelRequired: 'Enter or select a model.',
  modelCount: (count: number) => `${count} models`,
  manualModel: 'Model ID', request: 'Request URL', getKey: 'Get an API Key',
  more: 'More settings', reasoning: 'Reasoning effort', off: 'Off', low: 'Low', high: 'High', max: 'Maximum',
  images: 'Accept images', context: 'Context limit', maxTokens: 'Max output tokens',
  invalidNumber: 'Enter positive integers; context limit must exceed max output tokens.',
  save: 'Save', saveUse: 'Save and use', saving: 'Saving...', cancel: 'Cancel',
  required: 'Required.', duplicate: 'This name already exists.', retry: 'Retry',
  account: 'ChatGPT account', saveAccount: 'Save before signing in to ChatGPT.', signIn: 'Sign in to ChatGPT',
  unsupported: 'Switch to advanced mode to edit this provider.',
  savedNotStarted: 'Saved, but activation failed. Correct the settings and try again.',
  paused: 'Paused', running: 'Running', notConnected: 'Not connected',
  discard: 'Discard unsaved changes?', elapsed: (ms: number) => `${ms} ms`,
};

export const S = pick({
  zh, en, 'zh-Hant': zhHant, ja, ko, fr, de, 'es-419': es419, 'pt-BR': ptBR, it, ru,
});
