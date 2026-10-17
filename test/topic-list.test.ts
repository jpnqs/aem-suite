import { rememberTopics, splitTopics, withTopics } from '../app/subscriber/webapp/util/TopicList'

// The topic list of the Live Subscriber form (app/subscriber/webapp/util/TopicList.ts) - plain functions, no UI5.

describe('subscriber topic list', () => {
  it('splits typed or pasted text at commas', () => {
    expect(splitTopics(' a/b, c/> ,, ')).toEqual(['a/b', 'c/>'])
  })

  it('appends trimmed topics once', () => {
    expect(withTopics(['a/b'], [' c/> ', 'a/b', ''])).toEqual(['a/b', 'c/>'])
  })

  it('keeps the topics just used first in the history, each once, up to the limit', () => {
    expect(rememberTopics(['x', 'a'], ['a', 'b', 'c'], 3)).toEqual(['x', 'a', 'b'])
  })
})
