declare module 'node-turn' {
  class TurnServer {
    constructor(config: Record<string, unknown>)
    start(): void
  }
  export = TurnServer
}
