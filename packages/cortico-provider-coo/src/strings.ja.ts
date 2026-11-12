import type { en } from './strings.ts';

export const cooText: Partial<typeof en> = {
  description: (names: readonly string[]) => `1 つのモジュールで ${names.join('、')} に対応します。ベース URL からどのサービスか、どのプロトコルを使うかを判断します。思考は 4 段階で調整できます。`,
  tiers: { off: '思考なし', low: '思考 · 速い', high: '思考 · 標準', max: '思考 · 最も深い' },
  protocol: 'プロトコル',
  protocolHint: '未設定のとき、一覧にあるサービスはそれぞれのプロトコルを、それ以外の URL は responses を使います。responses：POST <URL>/responses、chat：POST <URL>/chat/completions、anthropic：Messages API（URL は /v1 より前の部分）、gemini：Gemini API（URL は /models より前の部分）。',
  badProtocol: (protocols: string) => `プロトコルは ${protocols} のいずれかにしてください`,
  httpRemote: "リモートのアドレスは https のみ使えます。http は暗号化されず、API Key と会話が平文で送られます。このコンピューターやローカルネットワークのアドレスは http でもかまいません。",
  catalog: {
    invalid: 'モデル一覧の設定が無効です。API URL、プロトコル、API Key を確認してください。',
    keyRequired: 'API Key を入力してください。URL、プロトコル、キー変数を変更した場合は再入力が必要です。',
    unsupported: 'このサービスは互換性のあるモデル一覧を提供していません。モデル ID を手動で入力してください。',
    timeout: 'モデル一覧の取得がタイムアウトしました。再試行してください。',
  },
  chatgpt: {
    panel: 'ChatGPT アカウント',
    description: 'ChatGPT アカウントでサインインし、リクエストはそのアカウントの ChatGPT プランの利用量に含まれます。',
    signedOut: 'ChatGPT にサインインしていません',
    returnToApp: 'サインインの結果はアプリに表示されます。このタブは閉じてかまいません。',
    reasons: { access_denied: 'アクセスが許可されませんでした', plan_not_granted: 'このアカウントで ChatGPT プランの利用が許可されませんでした', invalid_token_response: 'サービスは応答しましたが、応答の形式に互換性がありません', unsupported_country_region_territory: 'お住まいの地域はこのサービスに対応していません。対応地域：https://developers.openai.com/api/docs/supported-countries', timeout: 'ブラウザでのサインインがタイムアウトしました' },
  },
};
