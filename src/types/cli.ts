export type CliCommand = 'lint' | 'init';

export type CliInput = {
    /**
     * CLI command mode.
     */
    readonly command: CliCommand;
    /**
     * Files passed via CLI.
     * Empty list means full-scan mode.
     */
    readonly files: readonly string[];
    /**
     * Config path override.
     */
    readonly configPath: string;
    /**
     * Allow overwriting existing config in init mode.
     */
    readonly force: boolean;
};
