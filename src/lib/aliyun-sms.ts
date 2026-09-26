import crypto from 'crypto';

type AliyunSmsConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
};

export type AliyunSmsPurpose = 'register' | 'phone-change' | 'reset-password' | 'security';

type AliyunSmsResponse = {
  Code?: string;
  Message?: string;
  RequestId?: string;
  BizId?: string;
};

function getAliyunSmsConfig(): AliyunSmsConfig {
  const accessKeyId =
    process.env.ALIYUN_SMS_ACCESS_KEY_ID ?? process.env.ALIBABA_CLOUD_ACCESS_KEY_ID ?? '';
  const accessKeySecret =
    process.env.ALIYUN_SMS_ACCESS_KEY_SECRET ?? process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET ?? '';
  const signName = process.env.ALIYUN_SMS_SIGN_NAME ?? '';

  if (!accessKeyId || !accessKeySecret || !signName) {
    throw new Error('ALIYUN_SMS_NOT_CONFIGURED');
  }

  return { accessKeyId, accessKeySecret, signName };
}

function getAliyunSmsTemplateCode(purpose: AliyunSmsPurpose): string {
  const generic = process.env.ALIYUN_SMS_TEMPLATE_CODE ?? '';
  const templates: Record<AliyunSmsPurpose, string> = {
    register: process.env.ALIYUN_SMS_TEMPLATE_CODE_REGISTER ?? generic,
    'phone-change': process.env.ALIYUN_SMS_TEMPLATE_CODE_PHONE_CHANGE ?? generic,
    'reset-password': process.env.ALIYUN_SMS_TEMPLATE_CODE_RESET_PASSWORD ?? generic,
    security: process.env.ALIYUN_SMS_TEMPLATE_CODE_SECURITY
      ?? process.env.ALIYUN_SMS_TEMPLATE_CODE_RESET_PASSWORD
      ?? generic,
  };
  const templateCode = templates[purpose];
  if (!templateCode) {
    throw new Error('ALIYUN_SMS_NOT_CONFIGURED');
  }
  return templateCode;
}

function percentEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

function createAliyunSignature(params: Record<string, string>, accessKeySecret: string): string {
  const canonicalizedQueryString = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonicalizedQueryString)}`;
  return crypto
    .createHmac('sha1', `${accessKeySecret}&`)
    .update(stringToSign)
    .digest('base64');
}

export async function sendAliyunSmsCode(
  phone: string,
  code: string,
  purpose: AliyunSmsPurpose = 'register',
): Promise<void> {
  return sendAliyunSmsTemplate(phone, getAliyunSmsTemplateCode(purpose), { code });
}

export async function sendAliyunSmsTemplate(
  phone: string,
  templateCode: string,
  templateParams: Record<string, string | number>,
): Promise<void> {
  const config = getAliyunSmsConfig();
  if (!templateCode) throw new Error('ALIYUN_SMS_NOT_CONFIGURED');
  const params: Record<string, string> = {
    AccessKeyId: config.accessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: process.env.ALIYUN_SMS_REGION_ID ?? 'cn-hangzhou',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    SignName: config.signName,
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify(templateParams),
    Timestamp: new Date().toISOString(),
    Version: '2017-05-25',
  };
  const signature = createAliyunSignature(params, config.accessKeySecret);
  const body = new URLSearchParams({ ...params, Signature: signature });

  const res = await fetch('https://dysmsapi.aliyuncs.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  let data: AliyunSmsResponse = {};
  try {
    data = await res.json();
  } catch {}

  if (!res.ok || data.Code !== 'OK') {
    const message = data.Message || `HTTP ${res.status}`;
    throw new Error(`ALIYUN_SMS_SEND_FAILED:${data.Code ?? 'HTTP_ERROR'}:${message}`);
  }
}
