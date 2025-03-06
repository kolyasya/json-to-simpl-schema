import SimpleSchema from "simpl-schema";

// import SimpleSchema from "./simpl-schema/package/dist/main";
import {
    convertAnyOfToOneOf,
    getAllowedValuesOption,
    getBlackboxOption,
    getJsonSchemaProperties,
    getOptionalOption,
    getPrimitivePropertyType,
    getRegExOption,
    translateOptions,
} from "./utils";

const schemaCache = new Map();

export default class JsonToSimpleSchema {
    constructor(jsonSchema) {
        this.jsonSchema = jsonSchema;
    }

    toSimpleSchema() {
        const schemaId = this.jsonSchema?.$id;
        const properties = getJsonSchemaProperties(this.jsonSchema);

        const simpleSchemaEntries = Object.entries(properties).reduce(
            (accumulatedEntries, [propertyName, jsonProperty]) => {
                const simpleSchemaProperty = {
                    ...JsonToSimpleSchema.getSimpleSchemaTypeOption(jsonProperty),
                    ...getOptionalOption(propertyName, this.jsonSchema),
                    ...JsonToSimpleSchema.getCommonPropertyOptions(jsonProperty),
                };

                const propertyEntry = [propertyName, simpleSchemaProperty];
                let arrayEntries = [];

                if (simpleSchemaProperty.type === Array) {
                    const result = JsonToSimpleSchema.getArrayEntry(propertyName, jsonProperty);
                    // If result is an array of arrays (nested arrays case), spread it directly
                    arrayEntries = Array.isArray(result[0]) ? result : [result];
                }

                return accumulatedEntries.concat([propertyEntry, ...arrayEntries]);
            },
            [],
        );

        const schema = new SimpleSchema(Object.fromEntries(simpleSchemaEntries));

        if (schemaId) {
            schemaCache.set(schemaId, schema);
        }

        return schema;
    }

    static getSimpleSchemaTypeOption(jsonProperty) {
        const oneOfSchemas = jsonProperty.anyOf
            ? convertAnyOfToOneOf(jsonProperty.anyOf)
            : jsonProperty.oneOf;

        if (oneOfSchemas) {
            const schemas = oneOfSchemas.map((schema) => {
                const primitiveType = getPrimitivePropertyType(schema);

                if (primitiveType === Object) {
                    const { oneOf, anyOf, ...restJsonProperty } = jsonProperty;
                    const baseSchema = new JsonToSimpleSchema(restJsonProperty).toSimpleSchema();
                    const oneOfSchema = new JsonToSimpleSchema(schema).toSimpleSchema();

                    return oneOfSchema.extend(baseSchema);
                }

                return primitiveType;
            });

            if (schemas.every((schema) => schema === Array)) {
                return { type: Array };
            }

            return { type: SimpleSchema.oneOf(...schemas) };
        }

        const primitiveType = getPrimitivePropertyType(jsonProperty);

        const typeOption =
            primitiveType === Object &&
            ((jsonProperty.properties && !jsonProperty.additionalProperties) || jsonProperty.allOf)
                ? new JsonToSimpleSchema(jsonProperty).toSimpleSchema()
                : primitiveType;

        return { type: typeOption };
    }

    static getCommonPropertyOptions(property) {
        return {
            ...getBlackboxOption(property),
            ...getAllowedValuesOption(property),
            ...getRegExOption(property),
            ...translateOptions(property),
        };
    }

    static getArrayEntry(propertyName, jsonProperty) {
        if (jsonProperty.oneOf) {
            const arrayValues = jsonProperty.oneOf.map(
                (schema) => this.getArrayEntry(propertyName, schema)[1],
            );

            return [`${propertyName}.$`, SimpleSchema.oneOf(...arrayValues)];
        }

        // Handle nested arrays by recursively creating array entries
        if (jsonProperty.items?.type === "array") {
            const nestedEntries = [];
            let currentProperty = jsonProperty;
            let currentPath = propertyName;

            while (currentProperty.items?.type === "array") {
                nestedEntries.push([
                    `${currentPath}.$`,
                    {
                        type: Array,
                        ...this.getCommonPropertyOptions(currentProperty.items),
                    },
                ]);
                currentPath = `${currentPath}.$`;
                currentProperty = currentProperty.items;
            }

            // Add the final entry for the innermost array items
            nestedEntries.push([
                `${currentPath}.$`,
                {
                    ...JsonToSimpleSchema.getSimpleSchemaTypeOption(currentProperty.items),
                    ...this.getCommonPropertyOptions(currentProperty.items),
                },
            ]);

            return nestedEntries;
        }

        return [
            `${propertyName}.$`,
            {
                ...JsonToSimpleSchema.getSimpleSchemaTypeOption(jsonProperty.items),
                ...this.getCommonPropertyOptions(jsonProperty.items),
            },
        ];
    }
}
