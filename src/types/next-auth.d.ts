import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role?: string;
      authLevel?: 'primary_verified' | 'mfa_verified';
      mfaVerifiedAt?: number | null;
      mfaMethod?: 'totp' | 'recovery' | 'passkey' | null;
      sessionId?: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    authLevel?: 'primary_verified' | 'mfa_verified';
    mfaVerifiedAt?: number | null;
    mfaMethod?: 'totp' | 'recovery' | 'passkey' | null;
    sessionId?: string | null;
  }
}
