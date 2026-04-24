Just trying to make a html page where I can do some lookups on words. 


Update 2 23Apr26 - Finnish is broken. But I kept it for interesting sake. Lots of inaccurate takes. This is due to how I indexed everything with node.js. basically we search the index, not the OG jsonl which is like 3gb each language, and then pull from that. Lots of words have gotten 'lost in translation' when this happened. Eventually I may redo the indexing and see if I can find a better method.
Update 3 24Apr26 - Version 3 sorta. Not a huge change, just kind of changing the order of what appears based on if the word user searches is in the 'meanings' section on a translated word it has a higher 'score' this allows the top 5 words to be present (hopefully) and a drop down for other words. 