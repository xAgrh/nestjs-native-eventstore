import { Constructor, IEvent } from '@nestjs/cqrs';

export interface IEventConstructors {
  [key: string]: Constructor<IEvent>;
}
