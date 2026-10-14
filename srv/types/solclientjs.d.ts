/**
 * Minimal typings for solclientjs (the package ships an empty index.d.ts).
 * Only covers the API surface used by this project.
 */
declare module 'solclientjs' {
  namespace solace {
    interface Destination {
      getName(): string
    }

    interface SDTField {
      getType(): number
      getValue(): unknown
    }

    interface SDTMapContainer {
      addField(key: string, type: number, value: unknown): void
      getKeys(): string[]
      getField(key: string): SDTField
    }

    interface Message {
      setDestination(dest: Destination): void
      getDestination(): Destination | null
      setBinaryAttachment(value: string | Buffer | Uint8Array): void
      getBinaryAttachment(): Buffer | string | null
      getSdtContainer(): SDTField | null
      getType(): number
      setDeliveryMode(mode: number): void
      getDeliveryMode(): number
      setCorrelationKey(key: unknown): void
      setCorrelationId(id: string): void
      getCorrelationId(): string | null
      setTimeToLive(ms: number): void
      setDMQEligible(eligible: boolean): void
      setPriority(priority: number): void
      setHttpContentType(contentType: string): void
      getHttpContentType(): string | null
      setUserPropertyMap(map: SDTMapContainer): void
      getUserPropertyMap(): SDTMapContainer | null
      getSenderTimestamp(): number | null
      getReceiverTimestamp(): number | null
      acknowledge(): void
    }

    interface SessionEvent {
      sessionEventCode: number
      infoStr: string
      responseCode: number
      errorSubcode: number
      correlationKey: unknown
      reason: string
    }

    interface EventEmitterLike {
      on(event: string | number, listener: (...args: any[]) => void): void
      removeAllListeners(event?: string | number): void
    }

    interface MessageConsumer extends EventEmitterLike {
      connect(): void
      disconnect(): void
      dispose(): void
    }

    interface QueueBrowser extends EventEmitterLike {
      connect(): void
      disconnect(): void
      removeMessageFromQueue(message: Message): void
    }

    interface QueueDescriptor {
      name: string
      type: string
      durable?: boolean
    }

    interface Session extends EventEmitterLike {
      connect(): void
      disconnect(): void
      dispose(): void
      send(message: Message): void
      subscribe(topic: Destination, requestConfirmation: boolean, correlationKey: unknown, requestTimeout: number): void
      unsubscribe(topic: Destination, requestConfirmation: boolean, correlationKey: unknown, requestTimeout: number): void
      createMessageConsumer(props: {
        queueDescriptor: QueueDescriptor
        acknowledgeMode?: string
        createIfMissing?: boolean
      }): MessageConsumer
      createQueueBrowser(props: { queueDescriptor: QueueDescriptor }): QueueBrowser
    }

    interface SessionProperties {
      url: string
      vpnName: string
      userName: string
      password: string
      clientName?: string
      connectTimeoutInMsecs?: number
      connectRetries?: number
      reconnectRetries?: number
      generateSendTimestamps?: boolean
      generateReceiveTimestamps?: boolean
      publisherProperties?: { acknowledgeMode?: string; windowSize?: number }
    }

    interface SolclientFactoryProperties {
      profile: unknown
    }
  }

  interface SolaceModule {
    SolclientFactory: {
      init(props: solace.SolclientFactoryProperties): void
      setLogLevel(level: number): void
      createSession(props: solace.SessionProperties): solace.Session
      createMessage(): solace.Message
      createTopicDestination(name: string): solace.Destination
    }
    SolclientFactoryProperties: new () => solace.SolclientFactoryProperties
    SolclientFactoryProfiles: { version10: unknown; version10_5: unknown }
    SDTMapContainer: new () => solace.SDTMapContainer
    LogLevel: { FATAL: number; ERROR: number; WARN: number; INFO: number; DEBUG: number; TRACE: number }
    SessionEventCode: Record<
      | 'UP_NOTICE'
      | 'DOWN_ERROR'
      | 'CONNECT_FAILED_ERROR'
      | 'DISCONNECTED'
      | 'ACKNOWLEDGED_MESSAGE'
      | 'REJECTED_MESSAGE_ERROR'
      | 'SUBSCRIPTION_OK'
      | 'SUBSCRIPTION_ERROR'
      | 'MESSAGE',
      number
    >
    MessageConsumerEventName: Record<'UP' | 'DOWN' | 'DOWN_ERROR' | 'CONNECT_FAILED_ERROR' | 'MESSAGE', string>
    QueueBrowserEventName: Record<'UP' | 'DOWN' | 'DOWN_ERROR' | 'CONNECT_FAILED_ERROR' | 'MESSAGE', string>
    MessageConsumerAcknowledgeMode: { AUTO: string; CLIENT: string }
    MessagePublisherAcknowledgeMode: { PER_MESSAGE: string; WINDOWED: string }
    MessageDeliveryModeType: { DIRECT: number; PERSISTENT: number; NON_PERSISTENT: number }
    MessageType: { BINARY: number; MAP: number; STREAM: number; TEXT: number }
    SDTFieldType: { BOOL: number; INT64: number; STRING: number; [k: string]: number }
    QueueType: { QUEUE: string; TOPIC_ENDPOINT: string }
  }

  const solace: SolaceModule
  export = solace
}
