import { EventStoreSubscriptionType } from '../event-store.constants';
import { PersistentSubscriptionToStream } from '@eventstore/db-client';

export type EventStorePersistentSubscription = {
  type: EventStoreSubscriptionType.Persistent;
  stream: string;
  persistentSubscriptionName: string;
};

export interface ExtendedPersistentSubscription extends PersistentSubscriptionToStream {
  isLive?: boolean;
  isCreated?: boolean;
  stream: string;
  subscription: string;
}
