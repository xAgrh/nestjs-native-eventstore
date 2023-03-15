import {
  ErrorType,
} from '@eventstore/db-client/dist/utils';
import {
  EventStoreCatchupSubscription as EsCatchUpSubscription,
  EventStorePersistentSubscription as EsPersistentSubscription,
  ExtendedCatchUpSubscription,
  ExtendedPersistentSubscription,
} from './types';
import { EventStoreBusConfig, IEventConstructors } from '.';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { PARK, PersistentSubscriptionToStream, PersistentSubscriptionToStreamSettings, persistentSubscriptionToStreamSettingsFromDefaults, ResolvedEvent, RETRY, StreamNotFoundError, StreamSubscription } from '@eventstore/db-client';

import { EventStoreClient } from './client';
import { EventStoreSubscriptionType } from './event-store.constants';
import { IEvent } from '@nestjs/cqrs';
import { Subject } from 'rxjs';

export class EventStoreBus implements OnModuleDestroy {
  private eventHandlers: IEventConstructors = {};
  private logger = new Logger(this.constructor.name);

  private catchupSubscriptions: ExtendedCatchUpSubscription[] = [];
  private catchupSubscriptionCount = 0;

  private persistentSubscriptions: Map<string, ExtendedPersistentSubscription> = new Map();
  private persistentSubscriptionsCount = 0;

  constructor(
    private readonly client: EventStoreClient,
    private readonly subject$: Subject<IEvent>,
    private readonly config: EventStoreBusConfig,
  ) {
    this.addEventHandlers(this.config.events);

    const catchupSubscriptions =
      this.config.subscriptions?.filter((s) => {
        return s.type === EventStoreSubscriptionType.CatchUp;
      }) || [];

    this.subscribeToCatchUpSubscriptions(catchupSubscriptions as EsCatchUpSubscription[]);

    const persistentSubscriptions =
      this.config.subscriptions?.filter((s) => {
        return s.type === EventStoreSubscriptionType.Persistent;
      }) || [];

    this.subscribeToPersistentSubscriptions(persistentSubscriptions as EsPersistentSubscription[]);
  }

  async subscribeToPersistentSubscriptions(
    subscriptions: EsPersistentSubscription[],
  ): Promise<void> {

    const intervalID = setInterval(()=> {
      console.log('check', this.persistentSubscriptions)
      this.persistentSubscriptions?.forEach((sub) => {
        if (!sub.isLive) {
          this.reSubscribeToPersistentSubscription(sub.stream, sub.persistentSubscriptionName);
        }
      })
    }, 350000);

    this.persistentSubscriptionsCount = subscriptions.length;

    subscriptions?.forEach(async (sub: EsPersistentSubscription) => {
      // So 2 different variants can be returned
      // 1. {isLive: false, isCreated: true,}
      // 2. {isLive: false, isCreated: false,}
      const updatedSub: ExtendedPersistentSubscription = await this.createMissingPersistentSubscription(sub);

      this.persistentSubscriptions.set(updatedSub.stream, updatedSub)

      // Now idea is to setup connection only for isCreated

      if (updatedSub?.isCreated) {
        const subscription: PersistentSubscriptionToStream = await this.subscribeToPersistentSubscription(
          updatedSub.stream,
          updatedSub.persistentSubscriptionName,
        );

        if (subscription) {
          await this.handleSubscription(updatedSub, subscription);
        } else {
          updatedSub.isLive = false;
          updatedSub.subscription = null;
          this.persistentSubscriptions.set(updatedSub.stream, updatedSub)
        }
      } else {
        this.logger.warn(`Persistent subscription was not created: ${updatedSub.stream} ${updatedSub.persistentSubscriptionName}`);
        updatedSub.isCreated = false;
        this.persistentSubscriptions.set(updatedSub.stream, updatedSub)
        // Probably in this case we will need to resetup connection to the eventstore
        // For now we will need to just restart ms
      }
    });
  }

  async createMissingPersistentSubscription(
    sub: EsPersistentSubscription,
  ): Promise<ExtendedPersistentSubscription> {
    const settings: PersistentSubscriptionToStreamSettings = persistentSubscriptionToStreamSettingsFromDefaults({
      resolveLinkTos: true,
    });

    this.logger.verbose(
      `Starting to verify and create persistent subscription - ${JSON.stringify(sub)}`,
    );

    const subscription = await this.client
      .createPersistentSubscriptionToStream(sub.stream, sub.persistentSubscriptionName, settings)
      .then(() => {
        this.logger.log(`Created persistent subscription - ${sub.persistentSubscriptionName}:${sub.stream}`);
        return ({
          isLive: false,
          isCreated: true,
          stream: sub.stream,
          persistentSubscriptionName: sub.persistentSubscriptionName,
        } as ExtendedPersistentSubscription)
      })
      .catch((reason) => {
        if (reason.type === ErrorType.PERSISTENT_SUBSCRIPTION_EXISTS) {
          this.logger.log(
            `Persistent Subscription - ${sub.persistentSubscriptionName}:${sub.stream} already exists. Skipping creation.`,
          );
          return ({
            isLive: false,
            isCreated: true,
            stream: sub.stream,
            persistentSubscriptionName: sub.persistentSubscriptionName,
          } as ExtendedPersistentSubscription)
        } else {
          this.logger.error(`[${sub.stream}][${sub.persistentSubscriptionName}] can't be created \n Due: ${reason.message} ${reason.stack}`);

          return ({
            isLive: false,
            isCreated: false,
            stream: sub.stream,
            persistentSubscriptionName: sub.persistentSubscriptionName,
          } as ExtendedPersistentSubscription)
        }
      });

    return subscription;
  }


  async subscribeToPersistentSubscription(
    stream: string,
    subscriptionName: string,
  ): Promise<PersistentSubscriptionToStream> {
    try {
      const resolved = await this.client.subscribeToPersistentSubscriptionToStream(stream, subscriptionName) as PersistentSubscriptionToStream;
      
      return resolved;
    } catch (err) {
      this.logger.log('Dropped', err)
    }
    return null;
  }

  async handleSubscription(extendedSubscription, resolved: PersistentSubscriptionToStream) {
    try {
      resolved
        .on('data', (ev: ResolvedEvent) => {
          this.logger.log(`[${extendedSubscription.stream}][${extendedSubscription.persistentSubscriptionName}] Data received`)
        })
        .on('confirmation', () => {
          this.logger.verbose(`Connection to persistent subscription ${extendedSubscription.persistentSubscriptionName} on stream ${extendedSubscription.stream} established.`);

          const sub = this.persistentSubscriptions.get(extendedSubscription.stream);

          if (sub) {
            sub.isLive = true;

            sub.subscription = resolved;

            this.persistentSubscriptions.set(extendedSubscription.stream, sub)
          } else {
            this.logger.debug(`hmmmm`);
          }
        })
        .on('end', () => {
          this.logger.warn(`[${extendedSubscription.stream}][${extendedSubscription.persistentSubscriptionName}] Persistent subscription ended`);

          const sub = this.persistentSubscriptions.get(extendedSubscription.stream);

          if (sub) {
            sub.subscription = null;

            sub.isLive = false;
    
            this.persistentSubscriptions.set(extendedSubscription.stream, sub)
          } else {
            this.logger.debug(`hmmmm`);
          }
        })
        .on('close', () => {
          this.logger.debug(`[${extendedSubscription.stream}][${extendedSubscription.persistentSubscriptionName}] Persistent subscription closed`);

          const sub = this.persistentSubscriptions.get(extendedSubscription.stream);

          if (sub) {
            sub.subscription = null;

            sub.isLive = false;
    
            this.persistentSubscriptions.set(extendedSubscription.stream, sub)
          } else {
            this.logger.debug(`hmmmm`);
          }
        })
        .on('error', (err: Error) => {
          this.logger.error(`[${extendedSubscription.stream}][${extendedSubscription.persistentSubscriptionName}] Persistent subscription error`, err);

          const sub = this.persistentSubscriptions.get(extendedSubscription.stream);

          if (sub) {
            sub.subscription = null;

            sub.isLive = false;
    
            this.persistentSubscriptions.set(extendedSubscription.stream, sub)
          } else {
            this.logger.debug(`hmmmm`);
          }

        })
        .on('prefinish', (err: any) => {
          this.logger.error(`[${extendedSubscription.stream}][${extendedSubscription.persistentSubscriptionName}] Persistent subscription prefinish`, err);
          const sub = this.persistentSubscriptions.get(extendedSubscription.stream);

          if (sub) {
            sub.subscription = null;

            sub.isLive = false;
    
            this.persistentSubscriptions.set(extendedSubscription.stream, sub)
          } else {
            this.logger.debug(`hmmmm`);
          }
        })
        .on('finish', (err: any) => {
          this.logger.error(`[${extendedSubscription.stream}][${extendedSubscription.persistentSubscriptionName}] Persistent subscription finish`, err);
          const sub = this.persistentSubscriptions.get(extendedSubscription.stream);

          if (sub) {
            sub.subscription = null;

            sub.isLive = false;
    
            this.persistentSubscriptions.set(extendedSubscription.stream, sub)
          } else {
            this.logger.debug(`hmmmm`);
          }
        })
        .on('unpipe', (err: any) => {
          this.logger.error(`[${extendedSubscription.stream}][${extendedSubscription.persistentSubscriptionName}] Persistent subscription unpipe`, err);
          const sub = this.persistentSubscriptions.get(extendedSubscription.stream);

          if (sub) {
            sub.subscription = null;

            sub.isLive = false;
    
            this.persistentSubscriptions.set(extendedSubscription.stream, sub)
          } else {
            this.logger.debug(`hmmmm`);
          }
        });
        // .on('readable', (data) => {
        //   this.logger.log(`[${stream}][${subscriptionName}] Persistent subscription readable event`);
        // });

    } catch (error) {
      this.logger.error(`${extendedSubscription.stream}][${extendedSubscription.persistentSubscriptionName} Subscription dropped`);
      this.logger.error('restart...');
      const sub = this.persistentSubscriptions.get(extendedSubscription.stream);

      if (sub) {
        sub.subscription = null;

        sub.isLive = false;

        this.persistentSubscriptions.set(extendedSubscription.stream, sub)
      } else {
        this.logger.debug(`hmmmm`);
      }
      // this.reSubscribeToPersistentSubscription(extendedSubscription.stream, extendedSubscription.persistentSubscriptionName);
    }
    try {
      this.logger.verbose(`Listening stream of persistant subscription ${extendedSubscription.stream}`);
      for await (const event of resolved) {
        try {
          this.onEvent(event);

          resolved.ack(event);
          this.logger.log(`[${extendedSubscription.stream}][${extendedSubscription.persistentSubscriptionName}] Data added to eventstore successfully`);
        } catch (error) {
          this.logger.error({
            error: error,
            msg: `Error handling event`,
            event: error,
            stream: extendedSubscription.stream,
            persistentSubscriptionName: extendedSubscription.persistentSubscriptionName,
          });
          await resolved.nack(PARK, error.toString(), event);
        }
      }
    } catch (error) {
      this.logger.error(`${extendedSubscription.stream}][${extendedSubscription.persistentSubscriptionName} Subscription dropped`);
      this.logger.error('restart...');

      const sub = this.persistentSubscriptions.get(extendedSubscription.stream);

      if (sub) {
        sub.subscription = null;

        sub.isLive = false;

        this.persistentSubscriptions.set(extendedSubscription.stream, sub)
      } else {
        this.logger.debug(`hmmmm`);
      }
    }
  }

  async subscribeToCatchUpSubscriptions(subscriptions: EsCatchUpSubscription[]) {
    this.catchupSubscriptionCount = subscriptions.length;
    this.catchupSubscriptions = await Promise.all(
      subscriptions.map((sub) => {
        return this.subscribeToCatchUpSubscription(sub.stream);
      }),
    );
  }

  get allCatchupSubsriptionsLive(): boolean {
    const initialized = this.catchupSubscriptions.length === this.catchupSubscriptionCount;

    return (
      initialized &&
      this.catchupSubscriptions.every((sub) => {
        return !!sub && sub.isLive;
      })
    );
  }

  get allPersistentSubscriptionsLive(): boolean {
    const initialized = this.persistentSubscriptions.size === this.persistentSubscriptionsCount;

    const arr = Array.from(this.persistentSubscriptions, (entry) => {
      return {...entry[1]};
    });

    return (
      initialized &&
      arr?.every((sub) => {
        return !!sub && sub.isLive;
      })
    );
  }

  get isLive(): boolean {
    return this.allCatchupSubsriptionsLive && this.allPersistentSubscriptionsLive;
  }

  async publish(event: IEvent, stream?: string) {
    try {
      this.logger.debug({
        message: `Publishing event`,
        event,
        stream,
      });

      await this.client.writeEventToStream(stream || '$svc-catch-all', event?.constructor?.name, event);
    } catch (e) {
      this.logger.error('Something wrong with publishing event');
      this.logger.error(e);
    }
  }

  async publishAll(events: IEvent[], stream?: string) {
    try {
      this.logger.debug({
        message: `Publishing events`,
        events,
        stream,
      });
      this.client.writeEventsToStream(
        stream || '$svc.catch-all',
        events.map((ev) => {
          return {
            contentType: 'application/json',
            eventType: ev?.constructor.name || '',
            payload: ev,
          };
        }),
      );
    } catch (e) {
      this.logger.error(e);
      throw new Error(e);
    }
  }

  async subscribeToCatchUpSubscription(stream: string): Promise<ExtendedCatchUpSubscription> {
    try {
      const resolved = (await this.client.subscribeToCatchupSubscription(stream)) as ExtendedCatchUpSubscription;

      resolved
        .on('data', (ev: ResolvedEvent) => this.onEvent(ev))
        .on('confirmation', () => this.logger.log(`[${stream}] Catch-Up subscription confirmation`))
        .on('close', () => this.logger.log(`[${stream}] Subscription closed`))
        .on('error', (err: Error) => {
          this.logger.error({ stream, error: err, msg: `Subscription error` });
          this.onDropped(resolved);
        });

      this.logger.verbose(`Catching up and subscribing to stream ${stream}`);
      resolved.isLive = true;

      return resolved;
    } catch (e) {
      this.logger.error(`[${stream}] ${e.message} ${e.stack}`);
      throw new Error(e);
    }
  }

  onEvent(payload: ResolvedEvent) {
    const { event } = payload;

    if (!event || !event.isJson) {
      this.logger.error(`Received event that could not be resolved: ${event?.id}:${event?.streamId}`);
      return;
    }

    const { type, id, streamId, data } = event;

    const handler = this.eventHandlers[type];

    if (!handler) {
      this.logger.warn(`Received event that could not be handled: ${type}:${id}:${streamId}`);
      return;
    }

    const rawData = JSON.parse(JSON.stringify(data));
    const parsedData = Object.values(rawData);

    // we can wrap body of the event to rawData..content prop instead of using custom user/tenant/something
    if (this.eventHandlers && this.eventHandlers[type || rawData.content.eventType]) {
      // then subj will receive function 
      // new UserAddedEvent('N-p4TdRbk8frHa3QVJQ4G', {_tenantID: 'e2b38795-6d25-46e9-91c9-3b16ab698aca', _userID: null, timestamp: 1670861572217})
      const instance = new this.eventHandlers[type || rawData.content.eventType](...parsedData)
      this.logger.log(type)
      this.subject$.next(instance);
    } else {
      this.logger.warn(`Event of type ${type} not able to be handled.`);
    }
  }

  onLive(sub: ExtendedCatchUpSubscription | ExtendedPersistentSubscription) {
    sub.isLive = true;
  }

  onDropped(sub: ExtendedCatchUpSubscription | ExtendedPersistentSubscription) {
    sub.isLive = false;
  }

  async reSubscribeToPersistentSubscription(stream: string, subscriptionName: string) {
    this.logger.warn(`Reconnecting to subscription ${subscriptionName} ${stream}...`);

    const updatedSub = this.persistentSubscriptions.get(stream);

    const subscription: any = await this.subscribeToPersistentSubscription(
      stream,
      subscriptionName,
    );

    if (subscription) {
      await this.handleSubscription(updatedSub, subscription);
    } else {
      updatedSub.isLive = false;
      updatedSub.subscription = null;
      this.persistentSubscriptions.set(updatedSub.stream, updatedSub)
    }
  }

  addEventHandlers(eventHandlers: IEventConstructors) {
    this.eventHandlers = {
      ...this.eventHandlers,
      ...eventHandlers,
    };
  }

  onModuleDestroy() {
    this.logger.log('EventStoreBusModule destroyed')
    const arr = Array.from(this.persistentSubscriptions, (entry) => {
      return {...entry[1]};
    });
    arr?.forEach((sub) => {
      if (sub?.isLive) {
        this.logger.log(`[${sub.stream}][${sub.persistentSubscriptionName}] Unsubscribed`)
        sub.unsubscribe();
      }
    });
  }
}
