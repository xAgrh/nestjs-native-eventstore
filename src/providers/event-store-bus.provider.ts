import {
  CommandBus,
  EventHandlerType,
  ICommand,
  IEvent,
  IEventHandler,
  ISaga,
  InvalidSagaException,
  ObservableBus,
} from '@nestjs/cqrs';
import { EVENTS_HANDLER_METADATA, SAGA_METADATA } from '@nestjs/cqrs/dist/decorators/constants';
import { Injectable, Logger, OnModuleDestroy, Type } from '@nestjs/common';
import { Observable, Subscription } from 'rxjs';
import { EventStoreBus } from '../event-store.bus';
import { EventStoreBusConfig } from '../types/event-store-bus-config.type';
import { EventStoreClient } from '../client';
import { ModuleRef } from '@nestjs/core';
import { filter } from 'rxjs/operators';

@Injectable()
export class EventStoreBusProvider extends ObservableBus<IEvent> implements OnModuleDestroy {
  private _publisher: EventStoreBus;
  private readonly subscriptions: Subscription[];
  private readonly logger = new Logger(this.constructor.name);

  constructor(
    private readonly commandBus: CommandBus,
    private readonly moduleRef: ModuleRef,
    private readonly client: EventStoreClient,
    private config: EventStoreBusConfig,
  ) {
    super();
    this.subscriptions = [];

    this._publisher = new EventStoreBus(this.client, this.subject$, this.config);
  }

  get publisher(): EventStoreBus {
    return this._publisher;
  }

  set publisher(_publisher: EventStoreBus) {
    this._publisher = _publisher;
  }

  onModuleDestroy() {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  publish<T extends IEvent>(event: T, stream?: string) {
    if (!event) {
      return;
    }
    
    try {
      // Ensure we have a valid stream name
      const streamName = stream || this.getEventName(event);
      this._publisher.publish(event, streamName);
    } catch (error) {
      this.logger.error(`Failed to publish event: ${this.getEventName(event)}`, error);
      throw error;
    }
  }

  publishAll(events: IEvent[]) {
    if (!Array.isArray(events) || events.length === 0) {
      return;
    }

    events.forEach((event) => {
      try {
        this.publish(event);
      } catch (error) {
        this.logger.error(`Failed to publish event in batch: ${this.getEventName(event)}`, error);
        throw error;
      }
    });
  }

  bind(handler: IEventHandler<IEvent>, name: string) {
    const stream$ = name ? this.ofEventName(name) : this.subject$;
    const subscription = stream$.subscribe((ev) => handler.handle(ev));
    this.subscriptions.push(subscription);
  }

  registerSagas(types: Type<any>[] = []) {
    const sagas = types
      .map((target) => {
        const metadata = Reflect.getMetadata(SAGA_METADATA, target) || [];
        const instance = this.moduleRef.get(target, { strict: false });
        if (!instance) {
          throw new InvalidSagaException();
        }
        return metadata.map((k: string) => instance[k]);
      })
      .reduce((a, b) => a.concat(b), []);

    sagas.forEach((saga: ISaga<IEvent, ICommand>) => this.registerSaga(saga));
  }

  register(handlers: EventHandlerType[] = []) {
    handlers.forEach((hand) => this.registerHandler(hand));
  }

  protected registerHandler(handler: EventHandlerType) {
    const instance = this.moduleRef.get(handler, { strict: false });
    if (!instance) {
      return;
    }

    const eventsNames = this.reflectEventsNames(handler);
    eventsNames.map((ev) => this.bind(instance as IEventHandler<IEvent>, ev.name));
  }

  protected ofEventName(name: string) {
    return this.subject$.pipe(filter((ev) => this.getEventName(ev) === name));
  }

  private getEventName(event: IEvent): string {
    const { constructor } = Object.getPrototypeOf(event);
    return constructor.name as string;
  }

  protected registerSaga(saga: ISaga) {
    if (typeof saga !== 'function') {
      throw new InvalidSagaException();
    }

    const stream$ = saga(this);

    // this.logger.log('Is stream$ instance of observable: ', stream$ instanceof Observable);

    // if (!(stream$ instanceof Observable)) {
    //   throw new InvalidSagaException();
    // }

    const subscription = stream$.pipe(filter((e) => !!e)).subscribe((command) => this.commandBus.execute(command));

    this.subscriptions.push(subscription);
  }

  private reflectEventsNames(handler: EventHandlerType): FunctionConstructor[] {
    return Reflect.getMetadata(EVENTS_HANDLER_METADATA, handler);
  }
}
