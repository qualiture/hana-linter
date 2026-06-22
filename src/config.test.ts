import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJsonConfig } from './config';
import { ContentTarget, JsonLintConfig } from './types/rules';

const supportedTargets: ContentTarget[] = [
    'field',
    'inputParameter',
    'outputParameter',
    'roleName',
    'grantedRoleName',
    'sequenceName',
    'jobAction',
    'indexName',
    'triggerName'
];

describe('readJsonConfig', () => {
    it('accepts the bundled default configuration', async () => {
        const configPath = path.resolve(process.cwd(), 'src/assets/.hana-linter.json');
        await expect(readJsonConfig(configPath)).resolves.toBeDefined();
    });

    it.each(supportedTargets)('accepts content target "%s"', async (target) => {
        const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'hana-linter-config-'));
        const configPath = path.join(tempDir, '.hana-linter.json');

        const config: JsonLintConfig = {
            rootDir: 'db',
            ignoredDirectories: ['node_modules'],
            extensionRuleSets: [
                {
                    extension: '*',
                    groups: {
                        all: [{ description: 'Any name', pattern: '.+' }]
                    }
                }
            ],
            contentRuleSets: [
                {
                    extension: '.hdbtable',
                    target,
                    groups: {
                        all: [{ description: 'Any name', pattern: '.+' }]
                    }
                }
            ]
        };

        await fs.writeFile(configPath, JSON.stringify(config), 'utf-8');

        await expect(readJsonConfig(configPath)).resolves.toEqual(config);

        await fs.rm(tempDir, { recursive: true, force: true });
    });
});
