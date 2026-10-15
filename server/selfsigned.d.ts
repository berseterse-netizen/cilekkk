declare module 'selfsigned' {
  type AltName = { type: 2; value: string } | { type: 7; ip: string }

  const selfsigned: {
    generate(
      attrs: Array<{ name: string; value: string }>,
      options?: {
        keySize?: number
        algorithm?: string
        extensions?: Array<{ name: string; altNames: AltName[] }>
      },
    ): Promise<{ private: string; cert: string }>
  }

  export default selfsigned
}
