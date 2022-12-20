// import { EventStoreDBClient } from '@eventstore/db-client';
// import { Client, DNSClusterOptions } from '@eventstore/db-client/dist/Client';
// import { Logger } from '@nestjs/common';

// let eventStoreDBClient: EventStoreDBClient;

// const logger = new Logger('EventStoreClient');

// export function getEventStoreDBClient(connectionString): EventStoreDBClient {
//   if (!eventStoreDBClient) {
//     logger.log("Initializing eventstore client", connectionString)
//     let eventStoreDBClient: Client = EventStoreDBClient.connectionString('conne')
//   }

//   return eventStoreDBClient;
// }

// export const disconnectFromEventStoreDB = async (connectionString) => {
//   const eventStore = getEventStoreDBClient(connectionString);

//   try {
//     logger.log("Disconnecting eventstore client", connectionString)
//     return await eventStore.dispose();
//   } catch (ex) {
//     console.error(ex);
//   }
// };
