import OpenAI from 'openai'
import { DoppelClient } from '@doppel-llm-test/sdk'

let client: OpenAI | null = null

export function getOpenAI(): OpenAI {
  if (!client) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const apiKey = process.env.DOPPEL_API_KEY
    const shadowModel = process.env.DOPPEL_SHADOW_MODEL
    const serverUrl = process.env.DOPPEL_SERVER_URL ?? 'http://localhost:4000'

    if (apiKey && shadowModel) {
      try {
        console.log('[doppel-sdk] Initializing with:', { apiKey: apiKey.slice(0, 10) + '...', shadowModel, serverUrl })
        const doppel = new DoppelClient({
          apiKey,
          shadowModel,
          serverUrl,
        })
        client = doppel.wrapOpenAI(openai)
        console.log('[doppel-sdk] OpenAI client wrapped successfully')
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.warn('[doppel-sdk] Failed to wrap OpenAI client:', msg)
        client = openai
      }
    } else {
      client = openai
      if (!apiKey) console.warn('[doppel-sdk] DOPPEL_API_KEY not set')
      if (!shadowModel) console.warn('[doppel-sdk] DOPPEL_SHADOW_MODEL not set')
    }
  }
  return client
}
