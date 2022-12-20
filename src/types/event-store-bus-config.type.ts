import { IEventConstructors } from '../interfaces/event-constructors.interface';
import { EventStoreSubscription } from './event-store-subscription.type';

export type EventStoreBusConfig = {
  subscriptions: EventStoreSubscription[];
  events: IEventConstructors;
};
