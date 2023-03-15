import { EventStoreSubscriptionType } from '../event-store.constants';
import { PersistentSubscriptionToStream, StreamSubscription } from '@eventstore/db-client';

export type EventStorePersistentSubscription = {
  type: EventStoreSubscriptionType.Persistent;
  stream: string;
  persistentSubscriptionName: string;
};

export interface ExtendedPersistentSubscription extends PersistentSubscriptionToStream {
  type: EventStoreSubscriptionType.Persistent;
  stream: string;
  persistentSubscriptionName: string;
  subscription?: PersistentSubscriptionToStream;
  isCreated: boolean | undefined;
  isLive: boolean | undefined;
}
