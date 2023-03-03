import { Injectable, Logger } from '@nestjs/common';
import { AggregateRoot, IEvent } from '@nestjs/cqrs';
import { EventStoreBusProvider, IAggregateEvent } from '.';

export interface Constructor<T> {
  new(...args: any[]): T;
}

@Injectable()
export class EventStorePublisher<EventBase extends IEvent = IEvent> {
  private logger = new Logger(this.constructor.name);
  constructor(private readonly eventStoreBusProvider: EventStoreBusProvider) {}

  mergeClassContext<T extends Constructor<AggregateRoot<EventBase>>>(metatype: T): T {
    const eventBus = this.eventStoreBusProvider;
    return class extends metatype {
      publish(event: IEvent) {
        eventBus.publish(event, (event as IAggregateEvent).streamName);
      }
    };
  }

  mergeObjectContext<T extends AggregateRoot>(object: T): T {
    const eventBus = this.eventStoreBusProvider;
    // fckinfckinfck https://github.com/nestjs/cqrs/pull/335
    object.publishAll = (event: any[]) => (event || []).forEach((ev) => {
      return eventBus.publish(ev, (ev as IAggregateEvent).streamName)
    });
    
    return object;
  }
}
