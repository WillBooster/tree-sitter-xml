// A source and the tree it parses to with each grammar.
export const ExpectedTrees = {
  xml: {
    source: '<?xml version="1.0"?>\n<note><to>Tove</to></note>\n',
    tree: '(document (prolog (XMLDecl (VersionNum))) root: (element (STag (Name)) (content (element (STag (Name)) (content (CharData)) (ETag (Name)))) (ETag (Name))))',
  },
  dtd: {
    source: '<!ELEMENT note (to)>\n<!ATTLIST note id ID #REQUIRED>\n',
    tree: '(extSubset (elementdecl (Name) (contentspec (children (Name)))) (AttlistDecl (Name) (AttDef (Name) (TokenizedType) (DefaultDecl))))',
  },
};
