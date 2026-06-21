import { CstParser } from 'chevrotain';
import {
    allTokens,
    AscKw,
    BtreeKw,
    Comma,
    CpbtreeKw,
    CreateKw,
    DescKw,
    Dot,
    HashKw,
    Identifier,
    IndividualKw,
    IndexKw,
    InvertedKw,
    LParen,
    OnKw,
    QuotedIdentifier,
    RParen,
    Semicolon,
    UniqueKw,
    ValueKw
} from './lexer';

/**
 * Chevrotain CstParser for HANA `.hdbindex` DDL files.
 *
 * Grammar covers:
 *  - [CREATE] [UNIQUE] [<indexType>] INDEX <indexName> ON <tableName> <columnList> [;]
 *  - indexType: BTREE | CPBTREE | INVERTED HASH | INVERTED VALUE | INVERTED INDIVIDUAL
 *  - indexName: [schema "."] name  (quoted or unquoted)
 *  - tableName: [schema "."] name  (quoted or unquoted; consumed but not extracted)
 *  - columnList: "(" <col> [ASC|DESC] ("," <col> [ASC|DESC])* ")"
 *
 * Only the `indexName` node is surfaced by the visitor; tableName and
 * columnList sub-trees are parsed but blocked from extraction.
 *
 * Error recovery is enabled by default in CstParser.
 */
export class HdbIndexParser extends CstParser {
    constructor() {
        super(allTokens);
        this.performSelfAnalysis();
    }

    // -----------------------------------------------------------------------
    // Top-level rule:
    //   [CREATE] [UNIQUE] [<indexType>] INDEX <indexName> ON <tableName> <columnList> [;]
    //
    // CREATE, UNIQUE, and the index type are all optional.
    // IndexKw is the mandatory anchor token.
    // -----------------------------------------------------------------------

    public indexStatement = this.RULE('indexStatement', () => {
        this.OPTION(() => this.CONSUME(CreateKw));
        this.OPTION2(() => this.CONSUME(UniqueKw));
        this.OPTION3(() => this.SUBRULE(this.indexType));
        this.CONSUME(IndexKw);
        this.SUBRULE(this.indexName);
        this.CONSUME(OnKw);
        this.SUBRULE(this.tableName);
        this.SUBRULE(this.columnList);
        this.OPTION4(() => this.CONSUME(Semicolon));
    });

    // -----------------------------------------------------------------------
    // indexType: BTREE | CPBTREE | INVERTED (HASH | VALUE | INDIVIDUAL)
    //
    // The three INVERTED variants share the first token (InvertedKw).
    // An inner OR2 resolves the second token. No BACKTRACK is required.
    // -----------------------------------------------------------------------

    public indexType = this.RULE('indexType', () => {
        this.OR([
            { ALT: () => this.CONSUME(BtreeKw) },
            { ALT: () => this.CONSUME(CpbtreeKw) },
            {
                ALT: () => {
                    this.CONSUME(InvertedKw);
                    this.OR2([{ ALT: () => this.CONSUME(HashKw) }, { ALT: () => this.CONSUME(ValueKw) }, { ALT: () => this.CONSUME(IndividualKw) }]);
                }
            }
        ]);
    });

    // -----------------------------------------------------------------------
    // indexName: [schema "."] name
    //
    // Both quoted and unquoted forms are supported.
    // The schema qualifier (if present) is consumed structurally.
    // The visitor always extracts the LAST identifier child (local name).
    // -----------------------------------------------------------------------

    public indexName = this.RULE('indexName', () => {
        this.SUBRULE(this.identifier);
        this.OPTION(() => {
            this.CONSUME(Dot);
            this.SUBRULE2(this.identifier);
        });
    });

    // -----------------------------------------------------------------------
    // tableName: [schema "."] name
    //
    // Same structure as indexName; consumed entirely without extraction.
    // -----------------------------------------------------------------------

    public tableName = this.RULE('tableName', () => {
        this.SUBRULE(this.identifier);
        this.OPTION(() => {
            this.CONSUME(Dot);
            this.SUBRULE2(this.identifier);
        });
    });

    // -----------------------------------------------------------------------
    // columnList: "(" <columnRef> ("," <columnRef>)* ")"
    //
    // AT_LEAST_ONE_SEP is used because a valid HANA index requires at least
    // one column reference. Consumed entirely without extraction.
    // -----------------------------------------------------------------------

    public columnList = this.RULE('columnList', () => {
        this.CONSUME(LParen);
        this.AT_LEAST_ONE_SEP({
            SEP: Comma,
            DEF: () => this.SUBRULE(this.columnRef)
        });
        this.CONSUME(RParen);
    });

    // -----------------------------------------------------------------------
    // columnRef: <identifier> [ASC | DESC]
    //
    // A single column name with an optional sort-order keyword.
    // Consumed without extraction.
    // -----------------------------------------------------------------------

    public columnRef = this.RULE('columnRef', () => {
        this.SUBRULE(this.identifier);
        this.OPTION(() => {
            this.OR([{ ALT: () => this.CONSUME(AscKw) }, { ALT: () => this.CONSUME(DescKw) }]);
        });
    });

    // -----------------------------------------------------------------------
    // identifier: QuotedIdentifier | Identifier
    //
    // Shared leaf rule used by indexName, tableName, and columnRef.
    // -----------------------------------------------------------------------

    public identifier = this.RULE('identifier', () => {
        this.OR([{ ALT: () => this.CONSUME(QuotedIdentifier) }, { ALT: () => this.CONSUME(Identifier) }]);
    });
}

/**
 * Singleton parser instance — instantiated once at module load time
 * per Chevrotain best practices to avoid re-parsing the grammar on every
 * lint invocation.
 */
export const hdbIndexParser = new HdbIndexParser();
