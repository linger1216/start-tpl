/** 兼容旧部署的地域样例；新部署应通过 DATA_SCOPE_STREET_NAMES 指定本地名单。 */
export const DEFAULT_STREET_NAMES: readonly string[] = [
	// 4 个街道
	"江川路街道",
	"古美路街道",
	"新虹街道",
	"浦锦街道",
	// 9 个镇
	"莘庄镇",
	"七宝镇",
	"颛桥镇",
	"华漕镇",
	"虹桥镇",
	"梅陇镇",
	"吴泾镇",
	"马桥镇",
	"浦江镇",
	// 1 个工业区(按街镇管理)
	"莘庄工业区",
];

export const DEFAULT_NEIGHBORHOOD_TERMS = ["居委会", "村委会", "居民委员会", "村民委员会"] as const;
