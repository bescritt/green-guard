export class ReactUtils {
    static replaceWithJsx(valueToUpdate: string, replacement: Record<string, React.JSX.Element>): Array<string | React.JSX.Element> {
        const result: Array<string | React.JSX.Element> = [];
        const keys: string[] = Object.keys(replacement);
        const regExp: RegExp = new RegExp(keys.join("|"), 'g');

        let currentIndex: number = 0;
        Array.from(valueToUpdate.matchAll(regExp)).forEach((match) => {
            if (currentIndex < match.index) {
                result.push(valueToUpdate.substring(currentIndex, match.index));
            }

            result.push(replacement[match[0]]);
            currentIndex = match.index + match[0].length;
        });

        if (currentIndex < valueToUpdate.length) {
            result.push(valueToUpdate.substring(currentIndex, valueToUpdate.length));
        }

        return result;
    }
};