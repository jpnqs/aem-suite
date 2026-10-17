import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";

/**
 * Received messages wait here until the next flush puts them into the table, so a busy subscription does not
 * re-render the table for every message. Only the newest `max` are kept - also while the view is paused.
 */
export default class MessageBuffer<T> {
  private items: T[] = [];

  constructor(private readonly max: number) {}

  push(message: T): void {
    this.items.push(message);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }

  clear(): void {
    this.items = [];
  }

  /** The waiting messages on top of the shown ones (newest first), at most `max`; undefined if none are waiting. */
  flushInto(shown: T[]): T[] | undefined {
    if (!this.items.length) return undefined;
    const incoming = this.items.splice(0).reverse();
    return incoming.concat(shown).slice(0, this.max);
  }
}

/** The table filter for the search field: topic or payload contains the text (none for an empty search). */
export function messageFilter(query: string): Filter[] {
  if (!query) return [];
  return [
    new Filter({
      filters: [new Filter("topic", FilterOperator.Contains, query), new Filter("payload", FilterOperator.Contains, query)],
      and: false
    })
  ];
}
