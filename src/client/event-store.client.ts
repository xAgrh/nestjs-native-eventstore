import {
  AppendResult,
  END,
  EventStoreDBClient,
  jsonEvent,
  PersistentSubscriptionToStream,
  PersistentSubscriptionToStreamSettings,
  ReadRevision,
  START,
  StreamSubscription,
} from '@eventstore/db-client';
import { GossipClusterOptions, SingleNodeOptions } from '@eventstore/db-client/dist/Client';
import { Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { v4 } from 'uuid';
import {
  DnsClusterOptions,
  EventStoreConnectionStringOptions,
  EventStoreDnsClusterOptions,
  EventStoreEvent,
  EventStoreGossipClusterOptions,
  EventStoreSingleNodeOptions,
} from '../interfaces';

export class EventStoreClient {
  [x: string]: any;
  private logger: Logger = new Logger(this.constructor.name);
  private client: EventStoreDBClient;

  constructor(
    private options:
      | EventStoreConnectionStringOptions
      | EventStoreDnsClusterOptions
      | EventStoreGossipClusterOptions
      | EventStoreSingleNodeOptions,
  ) {
    try {
      if (this.options) {
        if ((this.options as EventStoreConnectionStringOptions).connectionString) {
          const { connectionString, parts } = options as EventStoreConnectionStringOptions;
          this.client = EventStoreDBClient.connectionString(connectionString, ...(parts || []));
        } else {
          const { connectionSettings, channelCredentials, defaultUserCredentials } = options as
            | EventStoreDnsClusterOptions
            | EventStoreGossipClusterOptions
            | EventStoreSingleNodeOptions;

          if ((connectionSettings as DnsClusterOptions).discover) {
            this.client = new EventStoreDBClient(
              connectionSettings as DnsClusterOptions,
              channelCredentials,
              defaultUserCredentials,
            );
          } else if ((connectionSettings as GossipClusterOptions).endpoints) {
            this.client = new EventStoreDBClient(
              connectionSettings as GossipClusterOptions,
              channelCredentials,
              defaultUserCredentials,
            );
          } else if ((connectionSettings as SingleNodeOptions).endpoint) {
            this.client = new EventStoreDBClient(
              connectionSettings as SingleNodeOptions,
              channelCredentials,
              defaultUserCredentials,
            );
          } else {
            throw Error('The connectionSettings property appears to be incomplete or malformed.');
          }
        }
      } else {
        throw Error('Connection information not provided.');
      }
    } catch (e) {
      this.logger.error(e);
      throw e;
    }
  }

  async writeEventToStream(streamName: string, eventType: string, payload: any, metadata?: any): Promise<AppendResult> {
    const event = jsonEvent({
      id: v4(),
      type: eventType,
      data: payload,
      metadata,
    });

    return this.client.appendToStream(streamName, event);
  }

  async writeEventsToStream(streamName: string, events: EventStoreEvent[]): Promise<AppendResult> {
    const jsonEvents = events.map((e) => {
      return jsonEvent({
        id: nanoid(),
        type: e.eventType,
        data: e.payload,
        metadata: e.metadata,
      });
    });

    return this.client.appendToStream(streamName, [...jsonEvents]);
  }

  async createPersistentSubscriptionToStream(
    streamName: string,
    persistentSubscriptionName: string,
    settings: PersistentSubscriptionToStreamSettings,
  ): Promise<void> {
    return this.client.createPersistentSubscriptionToStream(streamName, persistentSubscriptionName, settings);
  }

  async subscribeToPersistentSubscription(
    streamName: string,
    persistentSubscriptionName: string,
  ): Promise<PersistentSubscriptionToStream> {
    return this.client.subscribeToPersistentSubscriptionToStream(streamName, persistentSubscriptionName);
  }

  async subscribeToCatchupSubscription(streamName: string, fromRevision?: ReadRevision): Promise<StreamSubscription> {
    return this.client.subscribeToStream(streamName, {
      fromRevision: fromRevision || START,
      resolveLinkTos: true,
    });
  }

  async subscribeToVolatileSubscription(streamName: string): Promise<StreamSubscription> {
    return this.client.subscribeToStream(streamName, {
      fromRevision: END,
      resolveLinkTos: true,
    });
  }
}
