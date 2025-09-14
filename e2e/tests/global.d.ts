export {};

type SupabaseMinimal = {
  auth: { signInWithPassword: (args: { email: string; password: string }) => Promise<any> };
  from: (table: string) => any;
  rpc: (fn: string, args: any) => Promise<any>;
};

declare global {
  interface Window {
    supabase: SupabaseMinimal;
    __supabase_inject_error__?: string; // ← 追加
  }
}
