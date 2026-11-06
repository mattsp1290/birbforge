import {transport as upstream} from '../../app/src/transport.native';
import {createFixtureTransport} from './driver';

export const fixture = createFixtureTransport({upstream});
export const transport = fixture.transport;
