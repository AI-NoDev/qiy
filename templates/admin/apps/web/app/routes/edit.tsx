import { CanAccess, useTranslation } from "@refinedev/core";
import { Alert } from "antd";
import { useParams } from "react-router";
import { ResourceForm } from "../components/resource-form";
import { getResource } from "../resources";
export default function ResourceEdit() { const { translate } = useTranslation(); const params = useParams(); const resource = getResource(params.resource); return resource && params.id ? <CanAccess resource={resource.name} action="edit" fallback={<Alert type="error" message={translate("qiy.editForbidden", {}, "You do not have permission to edit this resource.")} />}><ResourceForm resource={resource} id={params.id} /></CanAccess> : <Alert type="error" message={translate("qiy.unknownResource", {}, "Unknown resource")} />; }
