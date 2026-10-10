import { useList, useTranslation } from "@refinedev/core";
import { Card, Col, Row, Space, Statistic, Typography } from "antd";
import { DatabaseOutlined, ShoppingOutlined, TableOutlined, UserOutlined } from "@ant-design/icons";
import { Link } from "react-router";
import { resources } from "../resources";
export default function Home() { const { getLocale } = useTranslation(); const english = getLocale() === "en-US"; return <Space direction="vertical" size="large" style={{ width: "100%" }}><div><Typography.Title level={2}>{english ? "Dashboard" : "工作台"}</Typography.Title></div><Row gutter={[16, 16]}>{resources.map((resource) => <ResourceSummary key={resource.name} resource={resource} />)}</Row></Space>; }
function ResourceSummary({ resource }: { resource: typeof resources[number] }) { const { result, query } = useList({ resource: resource.name, pagination: { currentPage: 1, pageSize: 1 } }); const icons = { DatabaseOutlined, ShoppingOutlined, TableOutlined, UserOutlined }; const Icon = icons[resource.icon as keyof typeof icons] ?? TableOutlined; return <Col xs={24} sm={12} lg={8}><Link to={`/${resource.name}`}><Card hoverable><Space><Icon style={{ fontSize: 24, color: "#1677ff" }} /><div><Typography.Text type="secondary">{resource.label}</Typography.Text><Statistic value={query.isLoading ? "—" : result.total ?? 0} /></div></Space></Card></Link></Col>; }
