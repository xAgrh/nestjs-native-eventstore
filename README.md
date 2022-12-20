<h1 align="center">
  <a href="https://github.com/EventStore/EventStore-Client-NodeJS" target="blank">NestJS + EventStore-Client-NodeJS</a>
</h1>
  
<p align="center">
  NestJS CQRS module with support EventStore-Client-NodeJS. It requires @nestjs/cqrs.
</p>

<p align="center">
<a href="https://www.npmjs.com/package/nestjs-native-eventstore" target="_blank"><img src="https://img.shields.io/npm/v/nestjs-native-eventstore?style=flat-square" alt="NPM Version"/></a>

<a href="https://img.shields.io/npm/l/nestjs-native-eventstore?style=flat-square" target="_blank"><img src="https://img.shields.io/npm/l/nestjs-native-eventstore?style=flat-square" alt="License"/></a>

<a href="https://img.shields.io/github/languages/code-size/xagrh/nestjs-native-eventstore?style=flat-square" target="_blank"><img src="https://img.shields.io/github/languages/code-size/xagrh/nestjs-native-eventstore?style=flat-square" alt="Code Size"/></a>
<a href="https://img.shields.io/github/languages/top/xagrh/nestjs-native-eventstore?style=flat-square" target="_blank"><img src="https://img.shields.io/github/languages/top/xagrh/nestjs-native-eventstore?style=flat-square" alt="Top Language"/></a>
<a href="https://github.com/xagrh/nestjs-native-eventstore"><img alt="GitHub Actions status" src="https://github.com/actions/setup-node/workflows/Main%20workflow/badge.svg"></a>
</p>




## Description
Injects eventstore connector modules, components, bus and eventstore config into a nestjs application. An example is provided in the examples folder.
It works with current latest version of nestjs along with latest version of EventStore-Client-NodeJS. via GRCP

### Installation
`npm i --save nestjs-native-eventstore`

### Usage

#### Using the EventStoreCoreModule

`EventStoreCoreModule` uses `@nestjs/cqrs` module under the hood. It overrides the default eventbus of `@nestjs/cqrs` and pushes the event to the eventstore rather than the internal eventBus.
Therefore the `eventStoreBus.publish(event, streamName)` method takes two arguments instead of one. The first one is the event itself, and the second one is the stream name. 

Once the event is pushed to the eventStore all the subscriptions listening to that event are pushed that event from the event store. Event handlers can then be triggered to cater for those events.

**app.module.ts**

```typescript
import { EventStoreSubscriptionType } from 'nestjs-native-eventstore';

//linking of events from EventStore to local events
const EventInstantiators = [
  SomeEvent: (_id: any, data: any, loggedInUserId: any) => new SomeEvent(_id, data, loggedInUserId);
];

export const eventStoreBusConfig: EventStoreBusConfig = {
  subscriptions: [
    { // persistanct subscription
      type: EventStoreSubscriptionType.Persistent,
      stream: '$ce-persons',
      persistentSubscriptionName: 'contacts',
    },
    { // Catchup subscription
      type: EventStoreSubscriptionType.CatchUp,
      stream: '$ce-users',
    },
  ],
  events: {
    ...EventInstantiators
  },
};

const eshost = process.env.EVENT_STORE_GRCP_HOST || 'localhost';
const esport = process.env.EVENT_STORE_GRCP_PORT || '2113';
const connectionString = `esdb://admin:changeit@${eshost}:${esport}?tls=false`;
const options:
  | EventStoreConnectionStringOptions
  | EventStoreDnsClusterOptions
  | EventStoreGossipClusterOptions
  | EventStoreSingleNodeOptions = {
    connectionString: connectionString,
  }

@Module({
  imports: [
    ConfigModule.load(path.resolve(__dirname, 'config', '**/!(*.d).{ts,js}')),
    EventStoreCoreModule.forRootAsync(
      {
        useFactory: async (config: ConfigService) => {
          return {
            options: options,
          };
        },
        inject: [ConfigService],
      },
      [eventStoreBusConfig],
    ),
  ],
})
export class AppModule {}

```

**custom.command.handler.ts**

This following is a way to use the command handlers that push to the custom eventBus to the eventstore using aggregate root.

```typescript
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import { SomeCommand } from '../impl/some.command';
import { EventStorePublisher } from 'nestjs-native-eventstore'; //this is necessary as it overrides the default publisher
import { ObjectAggregate } from '../../models/object.aggregate';

@CommandHandler(SomeCommand)
export class SomeCommandHandler
  implements ICommandHandler<SomeCommand> {
  constructor(private readonly publisher: EventStorePublisher) {}

  async execute(command: SomeCommand) {
    const { object, loggedInUserId } = command;
    const objectAggregate = this.publisher.mergeObjectContext(
      new ObjectAggregate(object._id, object),
    );
    objectAggregate.add(loggedInUserId);
    objectAggregate.commit();
  }
}

```

## Notice
 `2.0.0` release inspired by [nestjs-eventstore](https://github.com/daypaio/nestjs-eventstore)

## License

  This project is [MIT licensed](LICENSE).