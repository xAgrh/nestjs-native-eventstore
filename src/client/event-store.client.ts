import {
  ANY,
  AppendResult,
  END,
  EventStoreDBClient,
  EventType,
  jsonEvent,
  NO_STREAM,
  PersistentSubscriptionToStream,
  PersistentSubscriptionToStreamSettings,
  ReadRevision,
  ReadStreamOptions,
  ResolvedEvent,
  START,
  StreamingRead,
  StreamSubscription,
} from '@eventstore/db-client';
import { GossipClusterOptions, SingleNodeOptions } from '@eventstore/db-client/dist/Client';
import { Logger } from '@nestjs/common';
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
      console.log('Cant connect eventstore client')
      this.logger.error('Cant connect eventstore client', e);
      throw e;
    }
  }

  async writeEventToStream(streamName: string, eventType: string, payload: any, metadata?: any): Promise<AppendResult> {
    const event = jsonEvent({
      type: eventType,
      data: payload,
    });

    try {
      return await this.client.appendToStream(streamName, event);
    } catch (e) {
      this.logger.error('Something went wrong when we try to append event to stream', e)
      throw e;
    }
  }

  async writeEventsToStream(streamName: string, events: EventStoreEvent[]): Promise<AppendResult> {
    const jsonEvents = events.map((e) => {
      return jsonEvent({
        type: e.eventType,
        data: e.payload,
      });
    });

    try {
      return await this.client.appendToStream(streamName, [...jsonEvents]);
    } catch (e) {
      this.logger.error('Something went wrong when we try to append events to stream', e)
    }
  }

  async createPersistentSubscriptionToStream(
    streamName: string,
    persistentSubscriptionName: string,
    settings: PersistentSubscriptionToStreamSettings,
  ): Promise<void> {
    try {
      return this.client.createPersistentSubscriptionToStream(streamName, persistentSubscriptionName, settings);
    } catch(e) {
      this.logger.error('Cant be created', e)
    }
  }

  subscribeToPersistentSubscriptionToStream(
    streamName: string,
    persistentSubscriptionName: string,
  ): PersistentSubscriptionToStream {
    try {
      const subscription = this.client.subscribeToPersistentSubscriptionToStream(streamName, persistentSubscriptionName);
      return subscription;
    } catch(e) {
      this.logger.error('Cant be subscribed', e)
    }
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

  async readStream(streamName, options?: ReadStreamOptions, readableOptions?): Promise<StreamingRead<ResolvedEvent<EventType>>> {
    return this.client.readStream(streamName, options, readableOptions);
  }

  async deleteStream(streamName, group) {
    try {
      return await this.client.deleteStream(streamName, { expectedRevision: NO_STREAM });
    } catch (error) {
      this.logger.log(error);
    }
  }
}
