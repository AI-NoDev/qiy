export type FieldType = "UUID" | "Text" | "Integer" | "Decimal" | "Money" | "DateTime" | "File" | "Vector";
export interface ResourceEnumValue { name: string; label?: string; color?: string; icon?: string; }
export interface ResourceField { name: string; label: string; type: FieldType; nullable: boolean; primaryKey: boolean; visible: boolean; listVisible: boolean; formVisible: boolean; showVisible: boolean; sortable: boolean; filterable: boolean; enumName?: string; enumValues?: ResourceEnumValue[]; relation?: { resource: string; labelField: string }; icon?: string; dimension?: number; }
export interface ResourceDefinition { name: string; apiName: string; label: string; icon: string; menuParent?: string; fields: ResourceField[]; relatedResources?: Array<{ resource: string; field: string; label: string }>; }
export const menuGroups = [] as Array<{ name: string; label: string; icon: string; parent?: string }>;
export const resources: ResourceDefinition[] = [
  {
    "name": "records",
    "apiName": "records",
    "label": "records",
    "icon": "TableOutlined",
    "fields": [
      {
        "name": "id",
        "label": "id",
        "type": "UUID",
        "nullable": false,
        "primaryKey": true,
        "visible": false,
        "listVisible": false,
        "formVisible": false,
        "showVisible": false,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "tenantId",
        "label": "tenantId",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "title",
        "label": "title",
        "type": "Text",
        "nullable": false,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      },
      {
        "name": "createdAt",
        "label": "createdAt",
        "type": "DateTime",
        "nullable": true,
        "primaryKey": false,
        "visible": true,
        "listVisible": true,
        "formVisible": true,
        "showVisible": true,
        "sortable": true,
        "filterable": true
      }
    ]
  }
];
export const resourceNames = ["records"] as const;
export function getResource(name: string | undefined): ResourceDefinition | undefined { return resources.find((resource) => resource.name === name); }
