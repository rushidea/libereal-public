-- Bind mini-program login completion to the browser that started the challenge.
ALTER TABLE "WechatMiniLoginChallenge" ADD COLUMN "browserSecretHash" TEXT;
