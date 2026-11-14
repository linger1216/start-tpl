/** 由稳定键定位异步写入目标；已删除的目标不会转移到其他行。 */
export function updateKeyedItem<T>(items: T[], keys: readonly string[], key: string, update: (item: T) => T): T[] {
	const index = keys.indexOf(key);
	if (index < 0 || index >= items.length) return items;
	return items.map((item, i) => (i === index ? update(item) : item));
}
