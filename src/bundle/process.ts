import {
	existsSync,
	lstatSync,
	readFileSync,
} from 'fs'

import {
	CallExpression,
	Node,
	parse as parseLua,
	StringCallExpression,
} from 'moonsharp-luaparse'

import {Module, ModuleMap} from './module'

import {reverseTraverseRequires} from '../ast'

import {RealizedOptions} from './options'
import {readMetadata} from '../metadata'

type ResolvedModule = {
	name: string,
	resolvedPath: string,
}

export function resolveModule(name: string, packagePaths: readonly string[]) {
	for (const pattern of packagePaths) {
		const path = pattern.replace(/\?/g, name)

		if (existsSync(path) && lstatSync(path).isFile()) {
			return path
		}
	}
	return null
}

export function processModule(module: Module, options: RealizedOptions, processedModules: ModuleMap): void {
	let content = options.preprocess ? options.preprocess(module, options) : module.content

	const resolvedModules: ResolvedModule[] = []

	// Ensure we don't attempt to load modules required in nested bundles
	if (!readMetadata(content)) {
		const ast = parseLua(content, {
			locations: true,
			luaVersion: options.luaVersion,
			ranges: true,
		})

		reverseTraverseRequires(ast, expression => {
			const argument = (expression as StringCallExpression).argument || (expression as CallExpression).arguments[0]

			let required = null

			if (argument.type == 'StringLiteral') {
				required = argument.value
			} else if (options.expressionHandler) {
				required = options.expressionHandler(module, argument)
			}

			if (required) {
				const requiredModuleNames: string[] = Array.isArray(required) ? required : [required]

				for (const requiredModule of requiredModuleNames) {
					const resolvedPath = resolveModule(requiredModule, options.paths)

					if (!resolvedPath) {
						const start = expression.loc?.start!!
						throw new Error(`Could not resolve module '${requiredModule}' required by '${module.name}' at ${start.line}:${start.column}`)
					}

					resolvedModules.push({
						name: requiredModule,
						resolvedPath,
					})
				}

				if (typeof required === "string") {
					const range = expression.range!
					const baseRange = expression.base.range!
					content = content.slice(0, baseRange[1]) + '("' + required + '")' + content.slice(range[1])
				}
			}
		})
	}

	processedModules[module.name] = {
		...module,
		content,
	}

	for (const resolvedModule of resolvedModules) {
		if (processedModules[resolvedModule.name]) {
			continue
		}

		try {
			const moduleContent = readFileSync(resolvedModule.resolvedPath, 'utf8')
			processModule({
				...resolvedModule,
				content: moduleContent
			}, options, processedModules)
		} catch (e) {
			throw new Error(`Failed to bundle resolved module '${resolvedModule.name}'. Caused by:\n    ${e.stack.replace(/\n/g, '\n    ')}`)
		}
	}
}
