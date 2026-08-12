import { Storage } from '../BDTLL';

export class UUID {
    static async setUUID(): Promise<void> {
        const existingUUID: string = (await Storage.get('uuid')) as string;
        if (existingUUID) {
            return;
        }

        const newUUID: string = crypto.randomUUID();
        await Storage.set('uuid', newUUID);
    }
}