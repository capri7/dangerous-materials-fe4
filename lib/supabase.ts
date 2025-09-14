// lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

// 環境変数は NEXT_PUBLIC と非公開の両方を許容
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase env vars: SUPABASE_URL / SUPABASE_ANON_KEY')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export type MistakeRow = {
  id: string
  user_id: string
  question_id: string
  incorrect_count: number
  last_seen_at: string
  client_nonce: string
  deleted_at: string | null
}

export async function recordMistake(questionId: string): Promise<MistakeRow> {
  const { data, error } = await supabase.rpc('record_mistake', {
    p_question_id: questionId,
  })
  if (error) throw error
  return data as MistakeRow
}
