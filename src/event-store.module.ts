import { DynamicModule, Global, Module } from '@nestjs/common';
import {
  EventStoreConnectionStringOptions,
  EventStoreDnsClusterOptions,
  EventStoreGossipClusterOptions,
  EventStoreSingleNodeOptions,
} from './interfaces';

import { EVENT_STORE_CONNECTION_OPTIONS } from './event-store.constants';
import { EventStoreClient } from './client';

export interface EventStoreModuleAsyncOptions {
  useFactory: (...args: any[]) => Promise<any> | any;
  inject?: any[];
}

@Global()
@Module({
  providers: [EventStoreClient],
  exports: [EventStoreClient],
})
export class EventStoreModule {
  static forRootAsync(data: EventStoreModuleAsyncOptions): DynamicModule {
    return {
      module: EventStoreModule,
      providers: [
        {
          provide: EventStoreClient,
          useFactory: async (...args) => {
            const { options } = await data.useFactory(
              ...args,
            );
            return new EventStoreClient(options);
          },
          inject: data.inject,
        },
      ],
      exports: [EventStoreClient],
    };
  }
}
